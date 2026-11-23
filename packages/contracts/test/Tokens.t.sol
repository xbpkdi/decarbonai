// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC1155Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {BaseTest} from "./Base.t.sol";
import {DCO2} from "../src/DCO2.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {ERC8004ReputationAdapter} from "../src/ERC8004ReputationAdapter.sol";
import {IERC5192} from "../src/interfaces/IERC5192.sol";
import {Json} from "../src/lib/Json.sol";

contract DCO2Test is BaseTest {
    function test_mintLot_storesMetadataAndMints1to1() public view {
        DCO2.Lot memory l = dco2.lot(1);
        assertEq(l.registry, "Universal Carbon Registry");
        assertEq(l.projectId, "UCR-419");
        assertEq(l.serial, "SERIAL-1");
        assertEq(l.vintage, 2023);
        assertEq(l.quantityKg, 1000);
        assertEq(l.certificateURI, "https://app.carbonmark.com/retirements/id/SERIAL-1");
        assertEq(l.retirementTx, "eip155:8453:SERIAL-1");
        assertTrue(l.backed);
        assertTrue(dco2.isBacked(1));
        assertGt(l.mintedAt, 0);
        assertEq(dco2.balanceOf(address(pool), 1), 1e9);
        assertEq(dco2.totalSupply(1), 1e9);
        assertEq(dco2.nextLotId(), 2);
        assertTrue(dco2.serialUsed(keccak256(abi.encode("Universal Carbon Registry", "SERIAL-1"))));
        assertTrue(dco2.retirementUsed(keccak256(bytes("eip155:8453:SERIAL-1"))));
        assertTrue(dco2.backedToken());
        assertEq(dco2.name(), "DecarbonAI Carbon Tonne (custodial v0)");
        assertEq(dco2.symbol(), "DCO2");
    }

    function test_mintLot_onlyOwner() public {
        DCO2.Lot memory l = _lot("S2", 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vm.prank(agent);
        dco2.mintLot(agent, l);
    }

    function test_mintLot_validation() public {
        vm.startPrank(admin);
        vm.expectRevert(DCO2.SerialAlreadyMinted.selector);
        dco2.mintLot(admin, _lot("SERIAL-1", 1));
        vm.expectRevert(DCO2.ZeroQuantity.selector);
        dco2.mintLot(admin, _lot("S2", 0));
        DCO2.Lot memory l = _lot("", 1);
        vm.expectRevert(DCO2.EmptyField.selector);
        dco2.mintLot(admin, l);
        l = _lot("S2", 1);
        l.registry = "";
        vm.expectRevert(DCO2.EmptyField.selector);
        dco2.mintLot(admin, l);
        // a backed deployment needs the certificate and the source retirement tx
        l = _lot("S2", 1);
        l.certificateURI = "";
        vm.expectRevert(DCO2.EmptyField.selector);
        dco2.mintLot(admin, l);
        l = _lot("S2", 1);
        l.retirementTx = "";
        vm.expectRevert(DCO2.EmptyField.selector);
        dco2.mintLot(admin, l);
        // the same off-chain retirement cannot back two lots, even under another serial
        l = _lot("S2", 1);
        l.retirementTx = "eip155:8453:SERIAL-1";
        vm.expectRevert(DCO2.RetirementAlreadyUsed.selector);
        dco2.mintLot(admin, l);
        vm.stopPrank();
    }

    function test_mockToken_lotsAreUnbacked() public {
        DCO2 mock = new DCO2(admin, "DecarbonAI DCO2 (testnet mock, not backed by a real tonne)", "mockDCO2", false);
        DCO2.Lot memory l = _lot("MOCK-1", 5);
        l.certificateURI = "";
        l.retirementTx = "";
        vm.prank(admin);
        uint256 id = mock.mintLot(admin, l);
        assertFalse(mock.isBacked(id));
        assertFalse(mock.lot(id).backed);
        assertFalse(mock.backedToken());
        assertEq(mock.symbol(), "mockDCO2");
        assertGt(bytes(mock.uri(id)).length, 29);
    }

    function test_ownable2Step() public {
        address safe = makeAddr("safe");
        vm.prank(admin);
        dco2.transferOwnership(safe);
        assertEq(dco2.owner(), admin);
        assertEq(dco2.pendingOwner(), safe);
        vm.prank(safe);
        dco2.acceptOwnership();
        assertEq(dco2.owner(), safe);
    }

    function test_retire_requiresHolderOrOperator() public {
        vm.prank(admin);
        uint256 id = dco2.mintLot(agent, _lot("S2", 2));
        address op = makeAddr("op");
        vm.expectRevert(abi.encodeWithSelector(IERC1155Errors.ERC1155MissingApprovalForAll.selector, op, agent));
        vm.prank(op);
        dco2.retire(agent, id, 1);
        vm.prank(agent);
        dco2.setApprovalForAll(op, true);
        vm.prank(op);
        dco2.retire(agent, id, 5);
        vm.prank(agent);
        dco2.retire(agent, id, 5);
        assertEq(dco2.totalSupply(id), 2e6 - 10);
    }

    function test_uri_escapesOwnerStrings() public {
        DCO2.Lot memory l = _lot("S\"2", 1);
        l.projectName = "Quote \" back\\slash\nnewline";
        vm.prank(admin);
        uint256 id = dco2.mintLot(admin, l);
        string memory u = dco2.uri(id);
        assertEq(_prefix(u, 29), "data:application/json;base64,");
        vm.expectRevert(DCO2.UnknownLot.selector);
        dco2.uri(99);
        vm.expectRevert(DCO2.UnknownLot.selector);
        dco2.lot(99);
    }

    function _prefix(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; ++i) out[i] = b[i];
        return string(out);
    }
}

contract JsonTest is BaseTest {
    function test_escape() public pure {
        assertEq(Json.escape("plain"), "plain");
        assertEq(Json.escape("a\"b"), "a\\\"b");
        assertEq(Json.escape("a\\b"), "a\\\\b");
        assertEq(Json.escape("a\nb"), "a\\u000ab");
        assertEq(Json.escape(string(abi.encodePacked("x", bytes1(0x1f)))), "x\\u001f");
    }
}

contract CarbonReceiptTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _accrue(bytes32("p"), agent, AGENT_ID, KG);
    }

    function test_soulbound_transfersAndApprovalsRevert() public {
        address to = makeAddr("to");
        vm.startPrank(agent);
        vm.expectRevert(CarbonReceipt.Soulbound.selector);
        receipt.transferFrom(agent, to, 1);
        vm.expectRevert(CarbonReceipt.Soulbound.selector);
        receipt.safeTransferFrom(agent, to, 1);
        vm.expectRevert(CarbonReceipt.Soulbound.selector);
        receipt.approve(to, 1);
        vm.expectRevert(CarbonReceipt.Soulbound.selector);
        receipt.setApprovalForAll(to, true);
        vm.stopPrank();
        assertEq(receipt.ownerOf(1), agent);
    }

    function test_erc5192() public view {
        assertTrue(receipt.supportsInterface(0xb45a3c0e));
        assertEq(type(IERC5192).interfaceId, bytes4(0xb45a3c0e));
        assertTrue(receipt.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(receipt.locked(1));
    }

    function test_nonexistent() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 9));
        receipt.locked(9);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 9));
        receipt.retirement(9);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 9));
        receipt.tokenURI(9);
    }

    function test_onlyMinter() public {
        CarbonReceipt.Retirement memory r = receipt.retirement(1);
        vm.expectRevert(CarbonReceipt.NotMinter.selector);
        receipt.mint(r);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vm.prank(agent);
        receipt.setMinter(agent);
        // the minter is set once and can never be re-pointed, even by the owner
        vm.expectRevert(CarbonReceipt.MinterAlreadySet.selector);
        vm.prank(admin);
        receipt.setMinter(admin);
    }

    function test_mintToContractWithoutReceiverStillWorks() public {
        // pool itself has no onERC721Received; a contract payer must not block settlement
        address payer = address(usdc);
        _accrue(bytes32("c"), payer, 0, KG);
        assertEq(receipt.ownerOf(2), payer);
    }

    function test_tokenURI() public view {
        string memory u = receipt.tokenURI(1);
        assertGt(bytes(u).length, 29);
        assertEq(receipt.name(), "DecarbonAI Carbon Receipt");
    }
}

contract ReputationAdapterTest is BaseTest {
    function test_onlyPool() public {
        vm.expectRevert(ERC8004ReputationAdapter.NotPool.selector);
        adapter.recordCarbonSettled(AGENT_ID, 1, KG, bytes32(0));
    }

    function test_ownerSetters() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vm.prank(agent);
        adapter.setPool(agent);
        vm.prank(admin);
        adapter.setReceiptURIPrefix("x:");
        assertEq(adapter.receiptURIPrefix(), "x:");
        assertEq(address(adapter.registry()), address(registry));
    }
}

contract TestUSDCTest is BaseTest {
    uint256 internal pk = 0xA11CE;
    address internal signer;

    function setUp() public override {
        super.setUp();
        signer = vm.addr(pk);
        usdc.mint(signer, 100e6);
    }

    function _sig(bytes32 typehash, address to, uint256 value, uint256 va, uint256 vb, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(typehash, signer, to, value, va, vb, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_meta() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.symbol(), "tUSDC");
    }

    function test_faucetCap() public {
        vm.expectRevert(TestUSDC.FaucetCapExceeded.selector);
        usdc.mint(agent, 1_000e6 + 1);
    }

    function test_transferWithAuthorization() public {
        bytes32 th = usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH();
        bytes memory sig = _sig(th, agent, 1e6, 0, block.timestamp + 60, bytes32("n1"));
        usdc.transferWithAuthorization(signer, agent, 1e6, 0, block.timestamp + 60, bytes32("n1"), sig);
        assertEq(usdc.balanceOf(agent), 1e6);
        assertTrue(usdc.authorizationState(signer, bytes32("n1")));
        vm.expectRevert(TestUSDC.AuthorizationAlreadyUsed.selector);
        usdc.transferWithAuthorization(signer, agent, 1e6, 0, block.timestamp + 60, bytes32("n1"), sig);
    }

    function test_transferWithAuthorization_vrs() public {
        bytes32 th = usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(th, signer, agent, 2e6, 0, block.timestamp + 60, bytes32("n2")));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        usdc.transferWithAuthorization(signer, agent, 2e6, 0, block.timestamp + 60, bytes32("n2"), v, r, s);
        assertEq(usdc.balanceOf(agent), 2e6);
    }

    function test_authorizationTimingAndSignature() public {
        bytes32 th = usdc.TRANSFER_WITH_AUTHORIZATION_TYPEHASH();
        vm.warp(1000);
        bytes memory sig = _sig(th, agent, 1, 2000, 3000, bytes32("n"));
        vm.expectRevert(TestUSDC.AuthorizationNotYetValid.selector);
        usdc.transferWithAuthorization(signer, agent, 1, 2000, 3000, bytes32("n"), sig);
        sig = _sig(th, agent, 1, 0, 999, bytes32("n"));
        vm.expectRevert(TestUSDC.AuthorizationExpired.selector);
        usdc.transferWithAuthorization(signer, agent, 1, 0, 999, bytes32("n"), sig);
        sig = _sig(th, agent, 1, 0, 2000, bytes32("n"));
        vm.expectRevert(TestUSDC.InvalidSignature.selector);
        usdc.transferWithAuthorization(signer, agent, 2, 0, 2000, bytes32("n"), sig);
    }

    function test_receiveWithAuthorization() public {
        bytes32 th = usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH();
        bytes memory sig = _sig(th, agent, 3e6, 0, block.timestamp + 60, bytes32("r"));
        vm.expectRevert(TestUSDC.CallerMustBePayee.selector);
        usdc.receiveWithAuthorization(signer, agent, 3e6, 0, block.timestamp + 60, bytes32("r"), sig);
        vm.prank(agent);
        usdc.receiveWithAuthorization(signer, agent, 3e6, 0, block.timestamp + 60, bytes32("r"), sig);
        assertEq(usdc.balanceOf(agent), 3e6);
    }

    function test_cancelAuthorization() public {
        bytes32 nonce = bytes32("c");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdc.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(usdc.CANCEL_AUTHORIZATION_TYPEHASH(), signer, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory bad = abi.encodePacked(r, s, v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(TestUSDC.InvalidSignature.selector);
        usdc.cancelAuthorization(signer, nonce, bad);
        usdc.cancelAuthorization(signer, nonce, abi.encodePacked(r, s, v));
        vm.expectRevert(TestUSDC.AuthorizationAlreadyUsed.selector);
        usdc.cancelAuthorization(signer, nonce, abi.encodePacked(r, s, v));
    }
}

contract ZeroAddressTest is BaseTest {
    function test_zeroAddressSetters() public {
        vm.startPrank(admin);
        vm.expectRevert(CarbonReceipt.ZeroAddress.selector);
        receipt.setMinter(address(0));
        vm.expectRevert(ERC8004ReputationAdapter.ZeroAddress.selector);
        adapter.setPool(address(0));
        vm.stopPrank();
    }
}
