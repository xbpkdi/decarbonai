// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DCO2} from "../src/DCO2.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {ERC8004ReputationAdapter} from "../src/ERC8004ReputationAdapter.sol";
import {IERC8004Reputation, IERC8004Identity} from "../src/interfaces/IERC8004Reputation.sol";

/// @notice Deploys and wires the DecarbonAI v2 stack with separated roles, then hands admin off.
///         Writes ../../deployments/<chain>.json.
///
/// Roles (B1): the deployer is a throwaway key. It ends with no role once ADMIN accepts:
///   ADMIN     DEFAULT_ADMIN of the pool (AccessControlDefaultAdminRules, 2-step) and owner of DCO2,
///             CarbonReceipt and the adapter (Ownable2Step). A Safe multisig on mainnet.
///   TREASURY  can withdraw pool USDC.   PAUSER  can pause.
///   METER     METER_ROLE only: reports accruals. Hot key on the API server.
///   PAY_TO    x402 payTo (merchant revenue) and surcharge funder; approves the pool once.
///
/// Env:
///   DEPLOYER_PRIVATE_KEY (or FUJI_PRIVATE_KEY), METHODOLOGY_HASH, METHODOLOGY_VERSION
///   METER_ADDRESS, PAY_TO_ADDRESS             required; distinct from each other, the deployer and ADMIN
///   ADMIN_ADDRESS                             mainnet: required, not the deployer. Fuji: defaults to deployer
///   TREASURY_ADDRESS, PAUSER_ADDRESS          default ADMIN_ADDRESS
///   PAYMENT_TOKEN                             Fuji: optional (empty => TestUSDC). Mainnet: required (USDC)
///   DCO2_NAME, DCO2_SYMBOL, DCO2_BACKED       default per chain (Fuji: testnet mock; mainnet: backed)
///   LOT_*                                     backed deployments only: the first real lot, see _firstLot
///   THRESHOLD_MG (1e6), PRICE_PER_TONNE (25e6), MIN_PRICE_PER_TONNE (1e6),
///   MAX_MG_PER_ACCRUAL (100e6), MAX_MG_PER_DAY (1e9), ADMIN_DELAY (0)
contract Deploy is Script {
    address internal constant FUJI_8004_REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address internal constant FUJI_8004_IDENTITY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address internal constant MAINNET_8004_REPUTATION = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address internal constant MAINNET_8004_IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    error PaymentTokenRequiredOnMainnet();
    error AdminRequiredOnMainnet();
    error RolesNotSeparated();

    struct Params {
        uint256 pk;
        address deployer;
        address admin;
        address treasury;
        address pauser;
        address meter;
        address payTo;
        bytes32 methodologyHash;
        string methodologyVersion;
        address paymentToken;
        bool deployTestUSDC;
        address registry;
        address identity;
        string dco2Name;
        string dco2Symbol;
        bool backed;
        uint256 threshold;
        uint256 price;
        uint256 minPrice;
        uint256 maxPerAccrual;
        uint256 maxPerDay;
        uint48 adminDelay;
    }

    struct Deployed {
        address paymentToken;
        DCO2 dco2;
        CarbonReceipt receipt;
        RetirementPool pool;
        ERC8004ReputationAdapter adapter;
        uint256 lotId;
        uint256 startBlock;
    }

    function run() external {
        Params memory p = _params();
        Deployed memory d = _deploy(p);
        _write(p, d);
    }

    function _params() internal view returns (Params memory p) {
        bool mainnet = block.chainid == 43114;
        p.pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (p.pk == 0) p.pk = vm.envUint("FUJI_PRIVATE_KEY");
        p.deployer = vm.addr(p.pk);
        p.admin = vm.envOr("ADMIN_ADDRESS", address(0));
        if (p.admin == address(0)) {
            if (mainnet) revert AdminRequiredOnMainnet();
            p.admin = p.deployer;
        }
        p.treasury = vm.envOr("TREASURY_ADDRESS", p.admin);
        p.pauser = vm.envOr("PAUSER_ADDRESS", p.admin);
        p.meter = vm.envAddress("METER_ADDRESS");
        p.payTo = vm.envAddress("PAY_TO_ADDRESS");
        if (
            p.meter == p.deployer || p.meter == p.admin || p.meter == p.payTo || p.payTo == p.deployer
                || p.payTo == p.admin || (mainnet && (p.admin == p.deployer || p.treasury == p.deployer))
        ) revert RolesNotSeparated();

        p.methodologyHash = vm.envBytes32("METHODOLOGY_HASH");
        p.methodologyVersion = vm.envString("METHODOLOGY_VERSION");
        p.paymentToken = vm.envOr("PAYMENT_TOKEN", address(0));
        p.deployTestUSDC = p.paymentToken == address(0);
        if (p.deployTestUSDC && mainnet) revert PaymentTokenRequiredOnMainnet();
        p.registry = vm.envOr("REPUTATION_REGISTRY", mainnet ? MAINNET_8004_REPUTATION : FUJI_8004_REPUTATION);
        p.identity = vm.envOr("IDENTITY_REGISTRY", mainnet ? MAINNET_8004_IDENTITY : FUJI_8004_IDENTITY);

        p.backed = vm.envOr("DCO2_BACKED", mainnet);
        p.dco2Name = vm.envOr(
            "DCO2_NAME",
            p.backed
                ? string("DecarbonAI Carbon Tonne (custodial v0)")
                : string("DecarbonAI DCO2 (testnet mock, not backed by a real tonne)")
        );
        p.dco2Symbol = vm.envOr("DCO2_SYMBOL", p.backed ? string("DCO2") : string("mockDCO2"));

        p.threshold = vm.envOr("THRESHOLD_MG", uint256(1e6));
        p.price = vm.envOr("PRICE_PER_TONNE", uint256(25e6));
        p.minPrice = vm.envOr("MIN_PRICE_PER_TONNE", uint256(1e6));
        p.maxPerAccrual = vm.envOr("MAX_MG_PER_ACCRUAL", uint256(100e6));
        p.maxPerDay = vm.envOr("MAX_MG_PER_DAY", uint256(1e9));
        p.adminDelay = uint48(vm.envOr("ADMIN_DELAY", uint256(0)));
    }

    function _deploy(Params memory p) internal returns (Deployed memory d) {
        d.startBlock = block.number;
        vm.startBroadcast(p.pk);

        d.paymentToken = p.deployTestUSDC ? address(new TestUSDC()) : p.paymentToken;
        d.dco2 = new DCO2(p.deployer, p.dco2Name, p.dco2Symbol, p.backed);
        d.receipt = new CarbonReceipt(p.deployer);
        d.pool = new RetirementPool(
            RetirementPool.Config({
                admin: p.deployer,
                adminDelay: p.adminDelay,
                paymentToken: IERC20(d.paymentToken),
                dco2: d.dco2,
                receipt: d.receipt,
                identityRegistry: IERC8004Identity(p.identity),
                thresholdMg: p.threshold,
                minPricePerTonne: p.minPrice,
                pricePerTonne: p.price,
                maxMgPerAccrual: p.maxPerAccrual,
                maxMgPerDay: p.maxPerDay,
                maxRetirementsPerCall: 5
            })
        );
        d.adapter = new ERC8004ReputationAdapter(
            p.deployer, IERC8004Reputation(p.registry), _receiptPrefix(address(d.receipt))
        );

        d.receipt.setMinter(address(d.pool));
        d.adapter.setPool(address(d.pool));
        d.pool.setReputation(d.adapter);
        d.pool.grantRole(d.pool.METER_ROLE(), p.meter);
        d.pool.setSurchargeFunder(p.meter, p.payTo);
        d.pool.setMethodology(p.methodologyHash, p.methodologyVersion, true);

        (bool hasLot, DCO2.Lot memory lot) = _firstLot(p.backed);
        if (hasLot) {
            d.lotId = d.dco2.mintLot(address(d.pool), lot);
            d.pool.addLot(d.lotId);
        }

        _handOff(p, d);
        vm.stopBroadcast();
    }

    /// @dev Mock deployments get 1 t of mock inventory. Backed deployments mint only a real lot given
    ///      via LOT_* env (registry, project, serial, vintage, certificate URL, source retirement tx,
    ///      quantity in kg). Without it no lot is minted and retirements wait for the first real lot.
    function _firstLot(bool backed) internal view returns (bool, DCO2.Lot memory lot) {
        if (!backed) {
            lot = DCO2.Lot({
                registry: "MOCK (testnet, no registry)",
                projectId: "MOCK",
                projectName: "Testnet mock lot - not backed by a real tonne",
                serial: string.concat("DCAI-MOCK-", _chainName(), "-0001"),
                vintage: 2026,
                certificateURI: "",
                retirementTx: "",
                quantityKg: 1000,
                backed: false,
                mintedAt: 0
            });
            return (true, lot);
        }
        string memory serial = vm.envOr("LOT_SERIAL", string(""));
        if (bytes(serial).length == 0) return (false, lot);
        lot = DCO2.Lot({
            registry: vm.envString("LOT_REGISTRY"),
            projectId: vm.envString("LOT_PROJECT_ID"),
            projectName: vm.envString("LOT_PROJECT_NAME"),
            serial: serial,
            vintage: uint16(vm.envUint("LOT_VINTAGE")),
            certificateURI: vm.envString("LOT_CERTIFICATE_URI"),
            retirementTx: vm.envString("LOT_RETIREMENT_TX"),
            quantityKg: vm.envUint("LOT_QUANTITY_KG"),
            backed: true,
            mintedAt: 0
        });
        return (true, lot);
    }

    /// @dev Grants operational roles, then starts the 2-step admin/ownership transfer. Until ADMIN
    ///      accepts (pool.acceptDefaultAdminTransfer, *.acceptOwnership) the deployer still holds admin.
    function _handOff(Params memory p, Deployed memory d) internal {
        RetirementPool pool = d.pool;
        if (p.treasury != p.deployer) {
            pool.grantRole(pool.TREASURY_ROLE(), p.treasury);
            pool.renounceRole(pool.TREASURY_ROLE(), p.deployer);
        }
        if (p.pauser != p.deployer) {
            pool.grantRole(pool.PAUSER_ROLE(), p.pauser);
            pool.renounceRole(pool.PAUSER_ROLE(), p.deployer);
        }
        if (p.admin != p.deployer) {
            pool.beginDefaultAdminTransfer(p.admin);
            d.dco2.transferOwnership(p.admin);
            d.receipt.transferOwnership(p.admin);
            d.adapter.transferOwnership(p.admin);
        }
    }

    function _write(Params memory p, Deployed memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", d.startBlock);
        vm.serializeAddress(k, "deployer", p.deployer);
        vm.serializeAddress(k, "admin", p.admin);
        vm.serializeBool(k, "adminTransferPending", p.admin != p.deployer);
        vm.serializeAddress(k, "treasury", p.treasury);
        vm.serializeAddress(k, "pauser", p.pauser);
        vm.serializeAddress(k, "meter", p.meter);
        vm.serializeAddress(k, "payTo", p.payTo);
        vm.serializeAddress(k, "paymentToken", d.paymentToken);
        vm.serializeAddress(k, "dco2", address(d.dco2));
        vm.serializeBool(k, "dco2Backed", p.backed);
        vm.serializeString(k, "dco2Name", p.dco2Name);
        vm.serializeAddress(k, "carbonReceipt", address(d.receipt));
        vm.serializeAddress(k, "retirementPool", address(d.pool));
        vm.serializeAddress(k, "reputationAdapter", address(d.adapter));
        vm.serializeAddress(k, "erc8004ReputationRegistry", p.registry);
        vm.serializeAddress(k, "erc8004IdentityRegistry", p.identity);
        vm.serializeBytes32(k, "methodologyHash", p.methodologyHash);
        vm.serializeString(k, "methodologyVersion", p.methodologyVersion);
        vm.serializeUint(k, "thresholdMg", p.threshold);
        vm.serializeUint(k, "pricePerTonne", p.price);
        vm.serializeUint(k, "minPricePerTonne", p.minPrice);
        vm.serializeUint(k, "maxMgPerDay", p.maxPerDay);
        string memory json = vm.serializeUint(k, "initialLotId", d.lotId);
        string memory path = string.concat(vm.projectRoot(), "/../../deployments/", _chainName(), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }

    function _chainName() internal view returns (string memory) {
        if (block.chainid == 43113) return "fuji";
        if (block.chainid == 43114) return "avalanche";
        if (block.chainid == 31337) return "anvil";
        return vm.toString(block.chainid);
    }

    function _receiptPrefix(address receipt) internal view returns (string memory) {
        return string.concat("eip155:", vm.toString(block.chainid), ":", vm.toString(receipt), "/");
    }
}
