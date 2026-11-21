// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CertificateReceipt} from "../src/CertificateReceipt.sol";

/// @dev v1 legacy contract, kept because it is live on Fuji.
contract CertificateReceiptTest is Test {
    function test_recordOnlyRecorder() public {
        address recorder = makeAddr("recorder");
        CertificateReceipt c = new CertificateReceipt(recorder);
        vm.expectRevert(CertificateReceipt.NotRecorder.selector);
        c.record(bytes32("tx"), "url", 1, address(1));
        vm.prank(recorder);
        assertEq(c.record(bytes32("tx"), "url", 1, address(1)), 0);
        assertEq(c.nextId(), 1);
    }
}
