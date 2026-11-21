// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DCO2} from "../src/DCO2.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {ERC8004ReputationAdapter} from "../src/ERC8004ReputationAdapter.sol";
import {IERC8004Reputation} from "../src/interfaces/IERC8004Reputation.sol";

/// @notice Deploys and wires the DecarbonAI v2 stack, mints lot #1 into the pool and writes
///         ../../deployments/<chain>.json.
/// Env:
///   DEPLOYER_PRIVATE_KEY  deployer = admin, treasury, pauser, DCO2/receipt owner (falls back to FUJI_PRIVATE_KEY)
///   METHODOLOGY_HASH      keccak256 of the packages/core factor set (see npm run contracts:deploy)
///   METHODOLOGY_VERSION   human label of that factor set
///   PAYMENT_TOKEN         Fuji: optional, empty => deploy TestUSDC (EIP-3009). Mainnet: required (USDC)
///   METER_ADDRESS         optional; defaults to deployer
///   REPUTATION_REGISTRY   optional; defaults to the ERC-8004 ReputationRegistry of the chain
///   THRESHOLD_MG          optional; default 1e6 (1 kg)
///   PRICE_PER_TONNE       optional; default 25e6 ($25 / t in 6-decimal units)
contract Deploy is Script {
    address internal constant FUJI_8004_REPUTATION = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address internal constant MAINNET_8004_REPUTATION = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;

    error PaymentTokenRequiredOnMainnet();

    struct Params {
        uint256 pk;
        address deployer;
        bytes32 methodologyHash;
        string methodologyVersion;
        address paymentToken;
        bool deployTestUSDC;
        address meter;
        address registry;
        uint256 threshold;
        uint256 price;
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
        Params memory p;
        p.pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (p.pk == 0) p.pk = vm.envUint("FUJI_PRIVATE_KEY");
        p.deployer = vm.addr(p.pk);
        p.methodologyHash = vm.envBytes32("METHODOLOGY_HASH");
        p.methodologyVersion = vm.envString("METHODOLOGY_VERSION");
        p.paymentToken = vm.envOr("PAYMENT_TOKEN", address(0));
        p.deployTestUSDC = p.paymentToken == address(0);
        if (p.deployTestUSDC && block.chainid == 43114) revert PaymentTokenRequiredOnMainnet();
        p.meter = vm.envOr("METER_ADDRESS", p.deployer);
        p.registry =
            vm.envOr("REPUTATION_REGISTRY", block.chainid == 43114 ? MAINNET_8004_REPUTATION : FUJI_8004_REPUTATION);
        p.threshold = vm.envOr("THRESHOLD_MG", uint256(1e6));
        p.price = vm.envOr("PRICE_PER_TONNE", uint256(25e6));

        Deployed memory d = _deploy(p);
        _write(p, d);
    }

    function _deploy(Params memory p) internal returns (Deployed memory d) {
        d.startBlock = block.number;
        vm.startBroadcast(p.pk);

        d.paymentToken = p.deployTestUSDC ? address(new TestUSDC()) : p.paymentToken;
        d.dco2 = new DCO2(p.deployer);
        d.receipt = new CarbonReceipt(p.deployer);
        d.pool = new RetirementPool(
            RetirementPool.Config({
                admin: p.deployer,
                paymentToken: IERC20(d.paymentToken),
                dco2: d.dco2,
                receipt: d.receipt,
                thresholdMg: p.threshold,
                pricePerTonne: p.price,
                maxMgPerAccrual: 100 * 1e6, // 100 kg per call
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
        d.pool.setMethodology(p.methodologyHash, p.methodologyVersion, true);

        // Lot #1: MOCK inventory, not backed by a real tonne, on every chain (see README "Credit supply").
        d.lotId = d.dco2
            .mintLot(
                address(d.pool),
                DCO2.Lot({
                    registry: "MOCK (testnet, no registry)",
                    serial: "DCAI-MOCK-FUJI-0001",
                    projectName: "Testnet mock lot - not backed by a real tonne",
                    vintage: 2026,
                    retirementProofURI: "https://github.com/xbpkdi/decarbonai#credit-supply-dco2-is-a-testnet-mock",
                    tonnes: 1,
                    mintedAt: 0
                })
            );
        d.pool.addLot(d.lotId);

        vm.stopBroadcast();
    }

    function _write(Params memory p, Deployed memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", d.startBlock);
        vm.serializeAddress(k, "deployer", p.deployer);
        vm.serializeAddress(k, "meter", p.meter);
        vm.serializeAddress(k, "paymentToken", d.paymentToken);
        vm.serializeAddress(k, "dco2", address(d.dco2));
        vm.serializeAddress(k, "carbonReceipt", address(d.receipt));
        vm.serializeAddress(k, "retirementPool", address(d.pool));
        vm.serializeAddress(k, "reputationAdapter", address(d.adapter));
        vm.serializeAddress(k, "erc8004ReputationRegistry", p.registry);
        vm.serializeBytes32(k, "methodologyHash", p.methodologyHash);
        vm.serializeString(k, "methodologyVersion", p.methodologyVersion);
        vm.serializeUint(k, "thresholdMg", p.threshold);
        vm.serializeUint(k, "pricePerTonne", p.price);
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
