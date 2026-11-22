// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {DCO2} from "../src/DCO2.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";

/// @dev Runs the real deploy script against the local test chain (writes deployments/anvil.json).
contract DeployScriptTest is Test {
    uint256 internal constant PK = 0xBEEF;

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
    }
}
