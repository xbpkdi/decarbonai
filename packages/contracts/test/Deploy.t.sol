// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @dev Runs the real deploy script against the local test chain (writes deployments/anvil.json).
contract DeployScriptTest is Test {
    function test_deployScriptWiresEverything() public {
        vm.setEnv("FUJI_PRIVATE_KEY", vm.toString(uint256(0xBEEF)));
        vm.setEnv("METHODOLOGY_HASH", vm.toString(keccak256("m")));
        vm.setEnv("METHODOLOGY_VERSION", "test");
        new Deploy().run();
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../../deployments/anvil.json"));
        assertEq(vm.parseJsonUint(json, ".initialLotId"), 1);
        assertEq(vm.parseJsonAddress(json, ".deployer"), vm.addr(0xBEEF));
        assertTrue(vm.parseJsonAddress(json, ".retirementPool").code.length > 0);
        assertTrue(vm.parseJsonAddress(json, ".paymentToken").code.length > 0);
    }
}

contract DeployMainnetGuardTest is Test {
    function test_mainnetRequiresPaymentToken() public {
        vm.chainId(43114);
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(uint256(0xBEEF)));
        vm.setEnv("METHODOLOGY_HASH", vm.toString(keccak256("m")));
        vm.setEnv("METHODOLOGY_VERSION", "test");
        vm.setEnv("PAYMENT_TOKEN", vm.toString(address(0)));
        Deploy d = new Deploy();
        vm.expectRevert(Deploy.PaymentTokenRequiredOnMainnet.selector);
        d.run();
    }
}
