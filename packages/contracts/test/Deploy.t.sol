// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {DCO2} from "../src/DCO2.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";

contract SafeStub {
    uint256 public getThreshold;
    address[] internal _owners;

    constructor(uint256 threshold, address a, address b) {
        getThreshold = threshold;
        _owners.push(a);
        _owners.push(b);
    }

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }
}

contract UsdcStub {
    string public symbol = "USDC";
}

/// @dev Runs the real deploy script against the local test chain (writes deployments/anvil.json).
contract DeployScriptTest is Test {
    uint256 internal constant PK = 0xBEEF;
    Deploy internal script; // shared by the many rejection cases: deploying the script is most of their gas

    function _env(address admin) internal {
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(PK));
        vm.setEnv("METHODOLOGY_HASH", vm.toString(keccak256("m")));
        vm.setEnv("METHODOLOGY_VERSION", "test");
        vm.setEnv("METER_ADDRESS", vm.toString(makeAddr("meter")));
        vm.setEnv("PAY_TO_ADDRESS", vm.toString(makeAddr("payTo")));
        vm.setEnv("ADMIN_ADDRESS", vm.toString(admin));
        vm.setEnv("PAYMENT_TOKEN", vm.toString(address(0)));
        vm.setEnv("DCO2_BACKED", "false");
        vm.setEnv("LOT_SERIAL", "");
        vm.setEnv("LOT_FILE", "");
    }

    /// @dev forge runs tests in parallel and vm.setEnv is process-wide, so every scenario runs here, in order.
    function test_deployScenarios() public {
        _deploy_mockTestnet_separatedRolesAndHandoff();
        _deploy_backedWithoutLotMintsNothing();
        _deploy_backedWithRealLot();
        _deploy_backedWithLotFile();
        _deploy_rejectsSharedKeys();
        _deploy_mainnetGuards();
        _deploy_mainnetStrict();
        _deploy_requiresDeployerKey(); // last: there is no unsetEnv
    }

    function _read() internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/../../deployments/anvil.json"));
    }

    function _deploy_mockTestnet_separatedRolesAndHandoff() internal {
        address safe = makeAddr("safe");
        _env(safe);
        new Deploy().run();
        string memory json = _read();
        RetirementPool pool = RetirementPool(vm.parseJsonAddress(json, ".retirementPool"));
        DCO2 dco2 = DCO2(vm.parseJsonAddress(json, ".dco2"));
        CarbonReceipt receipt = CarbonReceipt(vm.parseJsonAddress(json, ".carbonReceipt"));
        address deployer = vm.addr(PK);

        assertEq(vm.parseJsonUint(json, ".initialLotId"), 1);
        assertFalse(dco2.backedToken());
        assertEq(dco2.symbol(), "mockDCO2");
        assertTrue(pool.hasRole(pool.METER_ROLE(), makeAddr("meter")));
        assertEq(pool.surchargeFunder(makeAddr("meter")), makeAddr("payTo"));
        // operational roles moved to the Safe; deployer keeps admin only until the Safe accepts
        assertTrue(pool.hasRole(pool.TREASURY_ROLE(), safe));
        assertFalse(pool.hasRole(pool.TREASURY_ROLE(), deployer));
        assertFalse(pool.hasRole(pool.PAUSER_ROLE(), deployer));
        (address pending,) = pool.pendingDefaultAdmin();
        assertEq(pending, safe);
        assertEq(dco2.pendingOwner(), safe);
        assertEq(receipt.pendingOwner(), safe);
        assertEq(receipt.minter(), address(pool));

        vm.warp(block.timestamp + 1);
        vm.startPrank(safe);
        pool.acceptDefaultAdminTransfer();
        dco2.acceptOwnership();
        vm.stopPrank();
        assertEq(pool.defaultAdmin(), safe);
        assertEq(dco2.owner(), safe);
    }

    function _deploy_backedWithoutLotMintsNothing() internal {
        _env(makeAddr("safe"));
        vm.setEnv("DCO2_BACKED", "true");
        new Deploy().run();
        string memory json = _read();
        assertEq(vm.parseJsonUint(json, ".initialLotId"), 0);
        DCO2 dco2 = DCO2(vm.parseJsonAddress(json, ".dco2"));
        assertTrue(dco2.backedToken());
        assertEq(dco2.symbol(), "DCO2");
    }

    function _deploy_backedWithRealLot() internal {
        _env(makeAddr("safe"));
        vm.setEnv("DCO2_BACKED", "true");
        vm.setEnv("LOT_SERIAL", "UCR-285-2023");
        vm.setEnv("LOT_REGISTRY", "Universal Carbon Registry");
        vm.setEnv("LOT_PROJECT_ID", "UCR-285");
        vm.setEnv("LOT_PROJECT_NAME", "Project");
        vm.setEnv("LOT_VINTAGE", "2023");
        vm.setEnv("LOT_CERTIFICATE_URI", "https://app.carbonmark.com/retirements/id/x");
        vm.setEnv("LOT_RETIREMENT_TX", "eip155:8453:0xabc");
        vm.setEnv("LOT_QUANTITY_KG", "100");
        new Deploy().run();
        string memory json = _read();
        DCO2 dco2 = DCO2(vm.parseJsonAddress(json, ".dco2"));
        assertEq(vm.parseJsonUint(json, ".initialLotId"), 1);
        assertTrue(dco2.isBacked(1));
        assertEq(dco2.lot(1).quantityKg, 100);
    }

    function _deploy_backedWithLotFile() internal {
        _env(makeAddr("safe"));
        vm.setEnv("DCO2_BACKED", "true");
        string memory path = string.concat(vm.projectRoot(), "/../../deployments/anvil-lot1.json");
        vm.writeFile(
            path,
            '{"registry":"UCR","projectId":"UCR-164","projectName":"Wind","serial":"UCR-164-2022","vintage":2022,'
            '"certificateURI":"https://app.carbonmark.com/retirements/id/x","retirementTx":"eip155:8453:0xfeed","quantityKg":1000}'
        );
        vm.setEnv("LOT_FILE", path);
        new Deploy().run();
        DCO2 dco2 = DCO2(vm.parseJsonAddress(_read(), ".dco2"));
        assertEq(dco2.lot(1).serial, "UCR-164-2022");
        assertEq(dco2.lot(1).quantityKg, 1000);
        assertTrue(dco2.isBacked(1));
        vm.setEnv("LOT_FILE", "");
    }

    function _deploy_rejectsSharedKeys() internal {
        _env(makeAddr("safe"));
        vm.setEnv("METER_ADDRESS", vm.toString(vm.addr(PK))); // meter == deployer
        Deploy d = new Deploy();
        vm.expectRevert(Deploy.RolesNotSeparated.selector);
        d.run();
        _env(makeAddr("safe"));
        vm.setEnv("PAY_TO_ADDRESS", vm.toString(makeAddr("meter"))); // payTo == meter
        vm.expectRevert(Deploy.RolesNotSeparated.selector);
        d.run();
    }

    function _deploy_mainnetGuards() internal {
        vm.chainId(43114);
        Deploy d = new Deploy();
        _env(address(0));
        vm.expectRevert(Deploy.AdminRequiredOnMainnet.selector);
        d.run();
        _env(vm.addr(PK)); // admin == deployer
        vm.expectRevert(Deploy.RolesNotSeparated.selector);
        d.run();
        _env(makeAddr("safe"));
        vm.expectRevert(Deploy.PaymentTokenRequiredOnMainnet.selector);
        d.run();
        vm.chainId(31337);
    }

    address internal constant USDC = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    string internal constant LOT_TX = "0xabababababababababababababababababababababababababababababababab";

    function _lotPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/../../deployments/anvil-lot1.json");
    }

    function _lotJson(string memory serial, string memory tx_, string memory uri, string memory who)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '{"registry":"UCR","projectId":"UCR-423","projectName":"Wind","serial":"',
            serial,
            '","vintage":2022,"certificateURI":"',
            uri,
            '","retirementTx":"',
            tx_,
            '","quantityKg":1000,"creditId":"UCR-423-2022","retirementId":"8453-x-0","beneficiary":"',
            who,
            '"}'
        );
    }

    function _goodLot() internal pure returns (string memory) {
        return _lotJson(
            "UCR-423-2022 / 8453-x-0",
            string.concat("eip155:8453:", LOT_TX),
            "https://app.carbonmark.com/retirements/id/x",
            "DecarbonAI"
        );
    }

    /// @dev A valid mainnet environment; every stray variable a sourced .env could add is back to unset.
    function _mainnetEnv() internal {
        _env(address(new SafeStub(2, makeAddr("s1"), makeAddr("s2"))));
        vm.setEnv("PAYMENT_TOKEN", vm.toString(USDC));
        vm.setEnv("DCO2_BACKED", "true");
        vm.setEnv("LOT_FILE", _lotPath());
        vm.setEnv("TREASURY_ADDRESS", vm.envString("ADMIN_ADDRESS"));
        vm.setEnv("PAUSER_ADDRESS", vm.envString("ADMIN_ADDRESS"));
        vm.setEnv("REPUTATION_REGISTRY", "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63");
        vm.setEnv("IDENTITY_REGISTRY", "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
        vm.setEnv("DCO2_NAME", "DecarbonAI Carbon Tonne (custodial v0)");
        vm.setEnv("DCO2_SYMBOL", "DCO2");
        vm.setEnv("THRESHOLD_MG", "1000000");
        vm.setEnv("PRICE_PER_TONNE", "25000000");
        vm.setEnv("MIN_PRICE_PER_TONNE", "1000000");
        vm.setEnv("MAX_MG_PER_ACCRUAL", "100000000");
        vm.setEnv("MAX_MG_PER_DAY", "1000000000");
        vm.setEnv("ADMIN_DELAY", "0");
        vm.writeFile(_lotPath(), _goodLot());
    }

    function _refused(string memory name, string memory value, bytes memory why) internal {
        _mainnetEnv();
        vm.setEnv(name, value);
        vm.expectRevert(why);
        script.run();
    }

    function _fixedOnMainnet(string memory name, string memory value) internal {
        _refused(name, value, abi.encodeWithSelector(Deploy.FixedOnMainnet.selector, name));
    }

    function _refusedLot(string memory json, string memory why) internal {
        _mainnetEnv();
        vm.writeFile(_lotPath(), json);
        vm.expectRevert(abi.encodeWithSelector(Deploy.BadLot.selector, why));
        script.run();
    }

    function _deploy_mainnetStrict() internal {
        script = new Deploy();
        vm.chainId(43114);
        string memory out = string.concat(vm.projectRoot(), "/../../deployments/avalanche.json");
        bool deployed = vm.exists(out); // true in a checkout that already holds the mainnet deployment
        vm.etch(USDC, address(new UsdcStub()).code);
        vm.store(USDC, bytes32(0), bytes32(abi.encodePacked("USDC", bytes27(0), uint8(8))));
        vm.etch(0x8004BAa17C55a88189AE136b182e5fdA19dE9b63, hex"00");
        vm.etch(0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, hex"00");

        _mainnetEnv();
        if (deployed) {
            vm.expectRevert(abi.encodeWithSelector(Deploy.AlreadyDeployed.selector, out));
            script.run();
            vm.chainId(31337);
            return;
        }
        script.run(); // the valid configuration deploys...
        assertFalse(vm.exists(out), "a simulation must not leave avalanche.json");

        _fixedOnMainnet("DCO2_BACKED", "false");
        _fixedOnMainnet("TREASURY_ADDRESS", vm.toString(makeAddr("other")));
        _fixedOnMainnet("PAUSER_ADDRESS", vm.toString(makeAddr("other")));
        _fixedOnMainnet("PAYMENT_TOKEN", vm.toString(makeAddr("token")));
        _fixedOnMainnet("REPUTATION_REGISTRY", "0x8004B663056A597Dffe9eCcC1965A193B7388713"); // Fuji's
        _fixedOnMainnet("IDENTITY_REGISTRY", "0x8004A818BFB912233c491871b3d84c89A494BD9e"); // Fuji's
        _fixedOnMainnet("DCO2_NAME", "x");
        _fixedOnMainnet("DCO2_SYMBOL", "mockDCO2");
        _fixedOnMainnet("THRESHOLD_MG", "500000");
        _fixedOnMainnet("PRICE_PER_TONNE", "26000000");
        _fixedOnMainnet("MIN_PRICE_PER_TONNE", "2");
        _fixedOnMainnet("MAX_MG_PER_ACCRUAL", "2");
        _fixedOnMainnet("MAX_MG_PER_DAY", "2");
        _fixedOnMainnet("ADMIN_DELAY", "1");
        _fixedOnMainnet("LOT_SERIAL", "stray");

        bytes memory notSeparated = abi.encodeWithSelector(Deploy.RolesNotSeparated.selector);
        _refused("TREASURY_ADDRESS", vm.toString(makeAddr("meter")), notSeparated);
        _refused("PAUSER_ADDRESS", vm.toString(vm.addr(PK)), notSeparated);
        _refused("TREASURY_ADDRESS", vm.toString(makeAddr("payTo")), notSeparated);

        _refusedAdmin(makeAddr("eoa"), abi.encodeWithSelector(Deploy.AdminNotASafe.selector, makeAddr("eoa")));
        _refusedAdmin(USDC, abi.encodeWithSelector(Deploy.AdminNotASafe.selector, USDC)); // a contract, no Safe
        _refusedAdmin(
            address(new SafeStub(1, makeAddr("s1"), makeAddr("s2"))),
            abi.encodeWithSelector(Deploy.SafeNeedsTwoSigners.selector, 1, 2)
        );
        _refusedAdmin(
            address(new SafeStub(2, makeAddr("s1"), vm.addr(PK))),
            abi.encodeWithSelector(Deploy.HotKeyIsSafeOwner.selector, vm.addr(PK))
        );
        _refusedAdmin(
            address(new SafeStub(2, makeAddr("meter"), makeAddr("s2"))),
            abi.encodeWithSelector(Deploy.HotKeyIsSafeOwner.selector, makeAddr("meter"))
        );

        _refused("LOT_FILE", "", abi.encodeWithSelector(Deploy.LotFileRequiredOnMainnet.selector));
        string memory tx_ = string.concat("eip155:8453:", LOT_TX);
        string memory uri = "https://app.carbonmark.com/retirements/id/x";
        string memory serial = "UCR-423-2022 / 8453-x-0";
        _refusedLot(_lotJson("UCR-423-2022", tx_, uri, "DecarbonAI"), "serial");
        _refusedLot(_lotJson(serial, "eip155:84532:0xabc", uri, "DecarbonAI"), "retirementTx");
        _refusedLot(_lotJson(serial, "eip155:8453:0xabc", uri, "DecarbonAI"), "retirementTx");
        _refusedLot(_lotJson(serial, tx_, "", "DecarbonAI"), "certificateURI");
        _refusedLot(_lotJson(serial, tx_, uri, "test"), "beneficiary");

        assertFalse(vm.exists(out));
        vm.chainId(31337);
    }

    function _refusedAdmin(address admin, bytes memory why) internal {
        _mainnetEnv();
        vm.setEnv("ADMIN_ADDRESS", vm.toString(admin));
        vm.setEnv("TREASURY_ADDRESS", vm.toString(admin));
        vm.setEnv("PAUSER_ADDRESS", vm.toString(admin));
        vm.expectRevert(why);
        script.run();
    }

    function _deploy_requiresDeployerKey() internal {
        _mainnetEnv();
        vm.setEnv("FUJI_PRIVATE_KEY", vm.toString(PK)); // must not be picked up
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "");
        vm.expectRevert();
        script.run();
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(PK));
    }
}
