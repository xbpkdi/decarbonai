// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {
    IAccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/IAccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {BaseTest} from "./Base.t.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";
import {DCO2} from "../src/DCO2.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {ICarbonReputation, IERC8004Identity} from "../src/interfaces/IERC8004Reputation.sol";
import {MockReputationRegistry} from "./mocks/MockReputationRegistry.sol";
import {GasBurnerReputation} from "./mocks/MockIdentityRegistry.sol";

contract RetirementPoolTest is BaseTest {
    event CarbonAccrued(
        bytes32 indexed paymentId,
        address indexed payer,
        uint256 indexed agentId,
        uint256 mgCO2e,
        uint256 surcharge,
        bytes32 methodologyHash,
        uint256 pendingMg
    );
    event AccrualSkipped(bytes32 indexed paymentId);
    event Retired(
        uint256 indexed receiptId,
        address indexed payer,
        uint256 indexed agentId,
        uint256 lotId,
        uint256 mgCO2e,
        uint64 accrualCount
    );
    event RetirementDeferred(address indexed payer, uint256 pendingMg);
    event ReputationRecorded(uint256 indexed agentId, uint256 indexed receiptId);
    event ReputationFailed(uint256 indexed agentId, uint256 indexed receiptId);
    event AgentLinked(address indexed payer, uint256 indexed agentId);
    event AgentLinkRejected(address indexed payer, uint256 indexed agentId);

    // ------------------------------------------------------------ constructor / config

    function test_constructor_validation() public {
        RetirementPool.Config memory c = _config(dco2, receipt);
        c.thresholdMg = 0;
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.BadThreshold.selector, 0));
        new RetirementPool(c);
        c.thresholdMg = 3; // does not divide 1 kg
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.BadThreshold.selector, 3));
        new RetirementPool(c);
        c = _config(dco2, receipt);
        c.maxMgPerAccrual = 0;
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        new RetirementPool(c);
        c = _config(dco2, receipt);
        c.maxMgPerDay = 0;
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        new RetirementPool(c);
        c = _config(dco2, receipt);
        c.maxRetirementsPerCall = 0;
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        new RetirementPool(c);
        c = _config(dco2, receipt);
        c.pricePerTonne = MIN_PRICE - 1;
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.PriceBelowFloor.selector, MIN_PRICE - 1, MIN_PRICE));
        new RetirementPool(c);
    }

    function test_initialState() public view {
        assertEq(pool.thresholdMg(), KG);
        assertEq(pool.pricePerTonne(), PRICE);
        assertEq(pool.minPricePerTonne(), MIN_PRICE);
        assertEq(address(pool.paymentToken()), address(usdc));
        assertEq(address(pool.identityRegistry()), address(identity));
        assertEq(pool.lotQueueLength(), 1);
        assertEq(pool.availableSupply(), 1e9);
        assertEq(pool.defaultAdmin(), admin);
        assertTrue(pool.hasRole(pool.TREASURY_ROLE(), admin));
        assertTrue(pool.hasRole(pool.PAUSER_ROLE(), admin));
        assertEq(pool.surchargeFunder(meter), payTo);
        assertTrue(pool.methodology(METHOD).active);
        assertEq(pool.dailyCapRemaining(), 1_000_000 * KG);
        assertTrue(pool.supportsInterface(0x4e2312e0)); // IERC1155Receiver
        assertTrue(pool.supportsInterface(type(IAccessControlDefaultAdminRules).interfaceId));
    }

    // ------------------------------------------------------------ quote

    function test_quote_roundsUp() public view {
        assertEq(pool.quote(1e9), PRICE);
        assertEq(pool.quote(1), 1);
        assertEq(pool.quote(40), 1);
        assertEq(pool.quote(41), 2);
    }

    function testFuzz_quote_neverUndercharges(uint128 mg, uint64 price) public {
        price = uint64(bound(price, MIN_PRICE, type(uint64).max));
        vm.prank(admin);
        pool.setPricePerTonne(price);
        uint256 q = pool.quote(mg);
        assertGe(q * 1e9, uint256(mg) * price);
        assertLt(q * 1e9, uint256(mg) * price + 1e9);
    }

    // ------------------------------------------------------------ accrue

    function test_accrue_recordsAndPullsFromFunder() public {
        uint256 mg = 22_000;
        uint256 s = pool.quote(mg);
        vm.expectEmit(address(pool));
        emit AgentLinked(agent, AGENT_ID);
        vm.expectEmit(address(pool));
        emit CarbonAccrued(bytes32("p1"), agent, AGENT_ID, mg, s, METHOD, mg);
        vm.prank(meter);
        pool.accrue(bytes32("p1"), agent, AGENT_ID, mg, s, METHOD);

        RetirementPool.Account memory a = pool.account(agent);
        assertEq(a.agentId, AGENT_ID);
        assertEq(a.pendingMg, mg);
        assertEq(a.totalMg, mg);
        assertEq(a.surchargePaid, s);
        assertEq(a.pendingSurcharge, s);
        assertEq(a.calls, 1);
        assertEq(a.pendingCalls, 1);
        assertEq(a.lastMethodology, METHOD);
        assertEq(usdc.balanceOf(address(pool)), s);
        assertEq(usdc.balanceOf(payTo), 1_000e6 - s);
        assertTrue(pool.paymentSeen(bytes32("p1")));
        assertEq(pool.totalAccruedMg(), mg);
        assertEq(pool.totalSurcharge(), s);
        assertEq(pool.totalAccruals(), 1);
        assertEq(pool.windowMg(), mg);
    }

    function test_accrue_meterWithoutFunderPaysItself() public {
        vm.prank(admin);
        pool.setSurchargeFunder(meter, address(0));
        usdc.mint(meter, 10e6);
        vm.prank(meter);
        usdc.approve(address(pool), type(uint256).max);
        _accrue(bytes32("p1"), agent, 0, 1000);
        assertEq(usdc.balanceOf(meter), 10e6 - pool.quote(1000));
    }

    function test_accrue_overpaymentAccepted() public {
        vm.prank(meter);
        pool.accrue(bytes32("p1"), agent, 0, 1000, 5e6, METHOD);
        assertEq(pool.account(agent).surchargePaid, 5e6);
    }

    function test_accrue_revertsForNonMeter() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, agent, pool.METER_ROLE())
        );
        vm.prank(agent);
        pool.accrue(bytes32("p1"), agent, 0, 1000, 1, METHOD);
    }

    function test_accrue_dedupesPaymentId() public {
        _accrue(bytes32("p1"), agent, 0, 1000);
        uint256 s = pool.quote(1000);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.DuplicatePayment.selector, bytes32("p1")));
        vm.prank(meter);
        pool.accrue(bytes32("p1"), makeAddr("other"), 0, 1000, s, METHOD);
    }

    function test_accrue_zeroInputsRevert() public {
        vm.startPrank(meter);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.accrue(bytes32(0), agent, 0, 1000, 1, METHOD);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.accrue(bytes32("p"), address(0), 0, 1000, 1, METHOD);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.accrue(bytes32("p"), agent, 0, 0, 1, METHOD);
        vm.stopPrank();
    }

    function test_accrue_unknownOrInactiveMethodology() public {
        bytes32 bad = keccak256("nope");
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.UnknownMethodology.selector, bad));
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, 0, 1000, 1, bad);
        vm.prank(admin);
        pool.setMethodology(METHOD, "v0-2026-08-anchored", false);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.UnknownMethodology.selector, METHOD));
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, 0, 1000, 1, METHOD);
    }

    function test_accrue_surchargeTooLow() public {
        uint256 q = pool.quote(KG);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.SurchargeTooLow.selector, q, q - 1));
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, 0, KG, q - 1, METHOD);
    }

    function test_accrue_tooLarge() public {
        uint256 mg = 1_000 * KG + 1;
        uint256 q = pool.quote(mg);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.AccrualTooLarge.selector, mg, 1_000 * KG));
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, 0, mg, q, METHOD);
    }

    function test_accrue_dailyCapAndWindowReset() public {
        vm.prank(admin);
        pool.setLimits(10 * KG, 3 * KG, 5);
        _accrue(bytes32("a"), agent, 0, 2 * KG);
        assertEq(pool.dailyCapRemaining(), KG);
        uint256 q = pool.quote(2 * KG);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.DailyCapExceeded.selector, 4 * KG, 3 * KG));
        vm.prank(meter);
        pool.accrue(bytes32("b"), agent, 0, 2 * KG, q, METHOD);
        vm.warp(block.timestamp + 1 days);
        assertEq(pool.dailyCapRemaining(), 3 * KG);
        _accrue(bytes32("b"), agent, 0, 2 * KG);
        assertEq(pool.windowMg(), 2 * KG);
    }

    function test_dailyCapRemaining_zeroWhenFull() public {
        vm.prank(admin);
        pool.setLimits(10 * KG, 2 * KG, 5);
        _accrue(bytes32("a"), agent, 0, 2 * KG);
        assertEq(pool.dailyCapRemaining(), 0);
        vm.prank(admin);
        pool.setLimits(10 * KG, KG, 5); // lowered below what was used
        assertEq(pool.dailyCapRemaining(), 0);
    }

    function test_accrue_whenPausedReverts() public {
        vm.prank(admin);
        pool.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, 0, 1000, 1, METHOD);
        vm.prank(admin);
        pool.unpause();
        _accrue(bytes32("p"), agent, 0, 1000);
    }

    function test_accrue_funderWithoutAllowanceReverts() public {
        vm.prank(payTo);
        usdc.approve(address(pool), 0);
        uint256 q = pool.quote(KG);
        vm.expectRevert();
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, 0, KG, q, METHOD);
    }

    // ------------------------------------------------------------ agent linking (on-chain identity check)

    function test_agentLink_requiresControlOfAgent() public {
        address stranger = makeAddr("stranger");
        vm.expectEmit(address(pool));
        emit AgentLinkRejected(stranger, AGENT_ID);
        _accrue(bytes32("p1"), stranger, AGENT_ID, 1000);
        assertEq(pool.account(stranger).agentId, 0);
        // nonexistent agent
        _accrue(bytes32("p2"), stranger, 999, 1000);
        assertEq(pool.account(stranger).agentId, 0);
        // registered agent wallet may link
        identity.set(7, makeAddr("owner7"), stranger);
        _accrue(bytes32("p3"), stranger, 7, 1000);
        assertEq(pool.account(stranger).agentId, 7);
        // a different agent later is rejected, link unchanged, accrual still counted
        identity.set(8, stranger, address(0));
        vm.expectEmit(address(pool));
        emit AgentLinkRejected(stranger, 8);
        _accrue(bytes32("p4"), stranger, 8, 1000);
        assertEq(pool.account(stranger).agentId, 7);
        assertEq(pool.account(stranger).calls, 4);
        // same agent again, or 0: link kept
        _accrue(bytes32("p5"), stranger, 7, 1000);
        _accrue(bytes32("p6"), stranger, 0, 1000);
        assertEq(pool.account(stranger).agentId, 7);
    }

    function test_agentLink_registryWithoutAgentWalletRejects() public {
        RetirementPool p2 = _poolWithIdentity(IERC8004Identity(address(new OwnerOnlyIdentity(makeAddr("x")))));
        _accrueOn(p2, bytes32("p"), agent, AGENT_ID);
        assertEq(p2.account(agent).agentId, 0);
    }

    function test_agentLink_noIdentityRegistryTrustsMeter() public {
        RetirementPool p2 = _poolWithIdentity(IERC8004Identity(address(0)));
        _accrueOn(p2, bytes32("p"), makeAddr("anyone"), 5);
        assertEq(p2.account(makeAddr("anyone")).agentId, 5);
    }

    function _poolWithIdentity(IERC8004Identity id) internal returns (RetirementPool p2) {
        RetirementPool.Config memory c = _config(dco2, receipt);
        c.identityRegistry = id;
        p2 = new RetirementPool(c);
        bytes32 meterRole = p2.METER_ROLE();
        vm.startPrank(admin);
        p2.grantRole(meterRole, meter);
        p2.setMethodology(METHOD, "v", true);
        vm.stopPrank();
        usdc.mint(meter, 1e6);
        vm.prank(meter);
        usdc.approve(address(p2), type(uint256).max);
    }

    function _accrueOn(RetirementPool p2, bytes32 id, address payer, uint256 agentId) internal {
        uint256 q = p2.quote(1000);
        vm.prank(meter);
        p2.accrue(id, payer, agentId, 1000, q, METHOD);
    }

    // ------------------------------------------------------------ batch

    function test_accrueBatch_oneTransferAndSkipsDuplicates() public {
        _accrue(bytes32("seen"), agent, 0, 1000);
        uint256 before = usdc.balanceOf(payTo);
        RetirementPool.Accrual[] memory items = new RetirementPool.Accrual[](3);
        items[0] = _item(bytes32("a"), agent, AGENT_ID, 10_000);
        items[1] = _item(bytes32("seen"), agent, 0, 10_000);
        items[2] = _item(bytes32("b"), makeAddr("bob"), 0, 20_000);
        vm.expectEmit(address(pool));
        emit AccrualSkipped(bytes32("seen"));
        vm.prank(meter);
        pool.accrueBatch(items);
        assertEq(pool.totalAccruals(), 3);
        assertEq(before - usdc.balanceOf(payTo), items[0].surcharge + items[2].surcharge);
        assertEq(pool.account(makeAddr("bob")).totalMg, 20_000);
        // resending the same batch is a no-op
        vm.prank(meter);
        pool.accrueBatch(items);
        assertEq(pool.totalAccruals(), 3);
    }

    function test_accrueBatch_emptyAndInvalidRevert() public {
        RetirementPool.Accrual[] memory empty = new RetirementPool.Accrual[](0);
        vm.expectRevert(RetirementPool.EmptyBatch.selector);
        vm.prank(meter);
        pool.accrueBatch(empty);
        RetirementPool.Accrual[] memory items = new RetirementPool.Accrual[](2);
        items[0] = _item(bytes32("a"), agent, 0, 10_000);
        items[1] = _item(bytes32("b"), agent, 0, 10_000);
        items[1].surcharge = 0;
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.SurchargeTooLow.selector, pool.quote(10_000), 0));
        vm.prank(meter);
        pool.accrueBatch(items);
        assertFalse(pool.paymentSeen(bytes32("a")));
    }

    function test_accrueBatch_sharesRetirementBudget() public {
        RetirementPool.Accrual[] memory items = new RetirementPool.Accrual[](2);
        items[0] = _item(bytes32("a"), agent, 0, 4 * KG);
        items[1] = _item(bytes32("b"), makeAddr("bob"), 0, 4 * KG);
        vm.prank(meter);
        pool.accrueBatch(items);
        assertEq(pool.totalRetirements(), 5); // 4 + 1, capped by maxRetirementsPerCall
        assertEq(pool.account(makeAddr("bob")).pendingMg, 3 * KG);
        pool.retire(makeAddr("bob"));
        assertEq(pool.account(makeAddr("bob")).pendingMg, 0);
    }

    // ------------------------------------------------------------ retirement

    function test_autoRetire_atThreshold_backedLotWritesReputation() public {
        _accrue(bytes32("p1"), agent, AGENT_ID, KG / 2);
        uint256 s = pool.quote(KG / 2);
        vm.expectEmit(address(pool));
        emit Retired(1, agent, AGENT_ID, 1, KG, 2);
        vm.expectEmit(address(pool));
        emit ReputationRecorded(AGENT_ID, 1);
        vm.prank(meter);
        pool.accrue(bytes32("p2"), agent, AGENT_ID, KG / 2, s, METHOD);

        RetirementPool.Account memory a = pool.account(agent);
        assertEq(a.pendingMg, 0);
        assertEq(a.retiredMg, KG);
        assertEq(a.receipts, 1);
        assertEq(a.pendingCalls, 0);
        assertEq(a.pendingSurcharge, 0);
        assertEq(dco2.balanceOf(address(pool), 1), 1e9 - KG);

        CarbonReceipt.Retirement memory r = receipt.retirement(1);
        assertEq(r.beneficiary, agent);
        assertEq(r.agentId, AGENT_ID);
        assertEq(r.lotId, 1);
        assertEq(r.mgCO2e, KG);
        assertEq(r.accrualCount, 2);
        assertEq(r.surcharge, 2 * s); // per batch, not all-time
        assertEq(r.methodologyHash, METHOD);
        assertTrue(r.backed);

        MockReputationRegistry.Entry memory e = registry.entry(0);
        assertEq(e.agentId, AGENT_ID);
        assertEq(e.client, address(adapter));
        assertEq(e.value, 1000);
        assertEq(e.decimals, 3);
        assertEq(e.tag1, "carbon-settled");
        assertEq(e.tag2, "dco2-retired");
        assertEq(e.feedbackURI, "dcrcpt:1");
    }

    function test_receiptSurchargeIsPerBatch() public {
        _accrue(bytes32("a"), agent, 0, KG);
        _accrue(bytes32("b"), agent, 0, KG);
        assertEq(receipt.retirement(1).surcharge, pool.quote(KG));
        assertEq(receipt.retirement(2).surcharge, pool.quote(KG));
    }

    function test_mockLot_noReputationAndUnbackedReceipt() public {
        DCO2 mock = new DCO2(admin, "mock", "mockDCO2", false);
        CarbonReceipt r2 = new CarbonReceipt(admin);
        RetirementPool p2 = new RetirementPool(_config(mock, r2));
        bytes32 meterRole = p2.METER_ROLE();
        DCO2.Lot memory l = _lot("MOCK-1", 10);
        l.certificateURI = "";
        l.retirementTx = "";
        vm.startPrank(admin);
        r2.setMinter(address(p2));
        p2.setReputation(adapter);
        p2.grantRole(meterRole, meter);
        p2.setMethodology(METHOD, "v", true);
        p2.addLot(mock.mintLot(address(p2), l));
        adapter.setPool(address(p2));
        vm.stopPrank();
        usdc.mint(meter, 1e6);
        vm.prank(meter);
        usdc.approve(address(p2), type(uint256).max);
        uint256 q = p2.quote(KG);
        vm.prank(meter);
        p2.accrue(bytes32("p"), agent, AGENT_ID, KG, q, METHOD);
        assertEq(r2.balanceOf(agent), 1);
        assertFalse(r2.retirement(1).backed);
        assertEq(registry.entryCount(), 0);
    }

    function test_autoRetire_multipleBatchesKeepsRemainder() public {
        _accrue(bytes32("p1"), agent, 0, 3 * KG + 123);
        RetirementPool.Account memory a = pool.account(agent);
        assertEq(a.receipts, 3);
        assertEq(a.pendingMg, 123);
        assertEq(receipt.retirement(1).accrualCount, 1);
        assertEq(receipt.retirement(2).accrualCount, 0);
        assertEq(receipt.retirement(2).surcharge, 0);
        assertEq(registry.entryCount(), 0); // no agent linked
    }

    function test_autoRetire_boundedPerCall_thenManualRetire() public {
        _accrue(bytes32("p1"), agent, 0, 7 * KG);
        assertEq(pool.account(agent).receipts, 5);
        vm.prank(makeAddr("anyone"));
        assertEq(pool.retire(agent), 2);
        assertEq(receipt.balanceOf(agent), 7);
    }

    function test_retire_belowThresholdAndPaused() public {
        _accrue(bytes32("p1"), agent, 0, KG - 1);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.BelowThreshold.selector, KG - 1, KG));
        pool.retire(agent);
        vm.prank(admin);
        pool.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.retire(agent);
    }

    function test_noSupply_defersThenRetiresAfterRestock() public {
        vm.prank(admin);
        pool.setLimits(1_000 * KG, 1_000_000 * KG, 255);
        address whale = makeAddr("whale");
        _accrue(bytes32("w1"), whale, 0, 1000 * KG);
        while (pool.account(whale).pendingMg >= KG) pool.retire(whale);
        assertEq(pool.availableSupply(), 0);

        uint256 s = pool.quote(KG);
        vm.expectEmit(address(pool));
        emit RetirementDeferred(agent, KG);
        vm.prank(meter);
        pool.accrue(bytes32("p1"), agent, 0, KG, s, METHOD);
        assertEq(pool.lotCursor(), 1);
        vm.expectRevert(RetirementPool.NoSupply.selector);
        pool.retire(agent);

        vm.startPrank(admin);
        uint256 lot2 = _mintLot("SERIAL-2", 1);
        vm.stopPrank();
        assertEq(pool.retire(agent), 1);
        assertEq(receipt.retirement(receipt.nextId() - 1).lotId, lot2);
    }

    function test_lotSkippedWhenShort_rescueAndRequeue() public {
        vm.startPrank(admin);
        uint256 lot2 = _mintLot("SERIAL-2", 1);
        // leave only 0.5 kg in lot 1, so it can no longer cover a 1 kg batch
        pool.rescueERC1155(IERC1155(address(dco2)), 1, admin, 1e9 - KG / 2);
        vm.stopPrank();
        _accrue(bytes32("a"), agent, 0, KG);
        assertEq(receipt.retirement(1).lotId, lot2);
        assertEq(pool.lotCursor(), 1);
        // top lot 1 back up and re-queue it
        vm.startPrank(admin);
        dco2.safeTransferFrom(admin, address(pool), 1, KG, "");
        pool.addLot(1);
        vm.stopPrank();
        assertEq(pool.availableSupply(), (3 * KG) / 2);
        _accrue(bytes32("b"), agent, 0, KG);
        assertEq(receipt.retirement(2).lotId, 1);
    }

    // ------------------------------------------------------------ reputation robustness

    function test_reputationFailure_pendingThenRetry() public {
        registry.setBroken(true);
        uint256 s = pool.quote(KG);
        vm.expectEmit(address(pool));
        emit ReputationFailed(AGENT_ID, 1);
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, AGENT_ID, KG, s, METHOD);
        assertEq(receipt.balanceOf(agent), 1);
        assertTrue(pool.feedbackPending(1));

        vm.expectRevert(bytes("broken"));
        pool.retryFeedback(1);
        assertTrue(pool.feedbackPending(1)); // revert restored the flag

        registry.setBroken(false);
        vm.expectEmit(address(pool));
        emit ReputationRecorded(AGENT_ID, 1);
        vm.prank(makeAddr("anyone"));
        pool.retryFeedback(1);
        assertFalse(pool.feedbackPending(1));
        assertEq(registry.entryCount(), 1);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.NoPendingFeedback.selector, 1));
        pool.retryFeedback(1);
    }

    function test_feedbackGasFloor_starvedCallReverts() public {
        _accrue(bytes32("p0"), agent, AGENT_ID, KG / 2);
        GasBurnerReputation burner = new GasBurnerReputation();
        vm.prank(admin);
        pool.setReputation(ICarbonReputation(address(burner)));
        uint256 s = pool.quote(KG / 2);
        // a caller that leaves too little gas for the feedback call cannot make it fail "silently"
        vm.expectRevert(RetirementPool.InsufficientGasForFeedback.selector);
        vm.prank(meter);
        pool.accrue{gas: 600_000}(bytes32("p1"), agent, AGENT_ID, KG / 2, s, METHOD);
        // with ample gas the burner fails inside try/catch and the feedback is left pending for retry
        vm.prank(meter);
        pool.accrue{gas: 30_000_000}(bytes32("p1"), agent, AGENT_ID, KG / 2, s, METHOD);
        assertTrue(pool.feedbackPending(1));
    }

    function test_reputationUnsetSkips() public {
        vm.prank(admin);
        pool.setReputation(ICarbonReputation(address(0)));
        _accrue(bytes32("p"), agent, AGENT_ID, KG);
        assertEq(registry.entryCount(), 0);
        assertEq(receipt.balanceOf(agent), 1);
    }

    // ------------------------------------------------------------ admin

    function test_admin_onlyAdmin() public {
        address x = makeAddr("x");
        bytes32 adminRole = pool.DEFAULT_ADMIN_ROLE();
        bytes memory err =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, x, adminRole);
        vm.startPrank(x);
        vm.expectRevert(err);
        pool.setThreshold(1);
        vm.expectRevert(err);
        pool.setPricePerTonne(MIN_PRICE);
        vm.expectRevert(err);
        pool.setLimits(1, 1, 1);
        vm.expectRevert(err);
        pool.setReputation(ICarbonReputation(address(0)));
        vm.expectRevert(err);
        pool.setMethodology(METHOD, "", true);
        vm.expectRevert(err);
        pool.addLot(1);
        vm.expectRevert(err);
        pool.setSurchargeFunder(meter, x);
        vm.expectRevert(err);
        pool.rescueERC1155(IERC1155(address(dco2)), 1, x, 1);
        bytes memory treasuryErr =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, x, pool.TREASURY_ROLE());
        vm.expectRevert(treasuryErr);
        pool.withdraw(x, 1);
        vm.expectRevert(treasuryErr);
        pool.rescueERC20(IERC20(address(usdc)), x, 1);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, x, pool.PAUSER_ROLE())
        );
        pool.pause();
        vm.stopPrank();
    }

    function test_admin_setters() public {
        vm.startPrank(admin);
        pool.setThreshold(500_000);
        assertEq(pool.thresholdMg(), 500_000);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.BadThreshold.selector, 0));
        pool.setThreshold(0);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.BadThreshold.selector, 2 * KG));
        pool.setThreshold(2 * KG);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.BadThreshold.selector, 300_000));
        pool.setThreshold(300_000);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.PriceBelowFloor.selector, 0, MIN_PRICE));
        pool.setPricePerTonne(0);
        pool.setLimits(10, 20, 2);
        assertEq(pool.maxMgPerAccrual(), 10);
        assertEq(pool.maxMgPerDay(), 20);
        assertEq(pool.maxRetirementsPerCall(), 2);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setLimits(0, 1, 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setLimits(1, 0, 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setLimits(1, 1, 0);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setMethodology(bytes32(0), "x", true);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setSurchargeFunder(address(0), payTo);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.EmptyLot.selector, 99));
        pool.addLot(99);
        vm.stopPrank();
    }

    function test_defaultAdmin_isTwoStepAndNotGrantable() public {
        address safe = makeAddr("safe");
        bytes32 adminRole = pool.DEFAULT_ADMIN_ROLE();
        vm.startPrank(admin);
        vm.expectRevert(IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminRules.selector);
        pool.grantRole(adminRole, safe);
        pool.beginDefaultAdminTransfer(safe);
        vm.stopPrank();
        assertEq(pool.defaultAdmin(), admin); // still admin until accepted
        vm.warp(block.timestamp + 1);
        vm.prank(safe);
        pool.acceptDefaultAdminTransfer();
        assertEq(pool.defaultAdmin(), safe);
        assertFalse(pool.hasRole(adminRole, admin));
    }

    function test_withdrawAndRescue() public {
        _accrue(bytes32("p"), agent, 0, 500 * KG);
        uint256 bal = usdc.balanceOf(address(pool));
        address treasury = makeAddr("treasury");
        TestUSDC stray = new TestUSDC();
        stray.mint(address(pool), 5);
        vm.startPrank(admin);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.withdraw(address(0), 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.withdraw(treasury, 0);
        pool.withdraw(treasury, bal);
        vm.expectRevert(RetirementPool.UsePaymentWithdraw.selector);
        pool.rescueERC20(IERC20(address(usdc)), treasury, 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.rescueERC20(IERC20(address(stray)), address(0), 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.rescueERC20(IERC20(address(stray)), treasury, 0);
        pool.rescueERC20(IERC20(address(stray)), treasury, 5);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.rescueERC1155(IERC1155(address(dco2)), 1, address(0), 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.rescueERC1155(IERC1155(address(dco2)), 1, treasury, 0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(treasury), bal);
        assertEq(stray.balanceOf(treasury), 5);
    }

    // ------------------------------------------------------------ fuzz

    /// @dev Conservation: accrued = retired + pending, retired = receipts * threshold = DCO2 burned.
    function testFuzz_batchSequence_conserves(uint32[12] memory amounts, uint8 thresholdIdx) public {
        uint256[4] memory thresholds = [uint256(KG), KG / 2, KG / 4, KG / 10];
        uint256 threshold = thresholds[thresholdIdx % 4];
        vm.startPrank(admin);
        pool.setThreshold(threshold);
        pool.setLimits(100 * KG, 1_000_000 * KG, 64);
        uint256 lot2 = _mintLot("BIG", 10_000);
        vm.stopPrank();

        RetirementPool.Accrual[] memory items = new RetirementPool.Accrual[](amounts.length);
        uint256 sum;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 mg = bound(amounts[i], 1, 4 * threshold);
            sum += mg;
            items[i] = _item(keccak256(abi.encode(i)), agent, AGENT_ID, mg);
        }
        vm.prank(meter);
        pool.accrueBatch(items);
        while (pool.account(agent).pendingMg >= threshold) pool.retire(agent);

        RetirementPool.Account memory a = pool.account(agent);
        assertEq(a.totalMg, sum);
        assertEq(a.retiredMg + a.pendingMg, sum);
        assertLt(a.pendingMg, threshold);
        assertEq(a.retiredMg, uint256(a.receipts) * threshold);
        assertEq(receipt.balanceOf(agent), a.receipts);
        assertEq(dco2.totalSupply(1) + dco2.totalSupply(lot2), 1e9 + 10_000 * KG - a.retiredMg);
        assertEq(registry.entryCount(), a.receipts);
        assertEq(usdc.balanceOf(address(pool)), a.surchargePaid);
    }

    function testFuzz_accrue_dedupe(bytes32 id, uint32 mg) public {
        vm.assume(id != bytes32(0));
        mg = uint32(bound(mg, 1, KG - 1));
        _accrue(id, agent, 0, mg);
        uint256 s = pool.quote(mg);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.DuplicatePayment.selector, id));
        vm.prank(meter);
        pool.accrue(id, agent, 0, mg, s, METHOD);
    }

    function testFuzz_multiplePayersIsolated(address p1, address p2, uint32 m1, uint32 m2) public {
        vm.assume(p1 != address(0) && p2 != address(0) && p1 != p2);
        vm.assume(p1.code.length == 0 && p2.code.length == 0);
        m1 = uint32(bound(m1, 1, 3 * KG));
        m2 = uint32(bound(m2, 1, 3 * KG));
        _accrue(bytes32("a"), p1, 0, m1);
        _accrue(bytes32("b"), p2, 0, m2);
        assertEq(pool.account(p1).pendingMg, m1 % KG);
        assertEq(pool.account(p2).pendingMg, m2 % KG);
        assertEq(pool.totalAccruedMg(), uint256(m1) + m2);
    }
}

/// @dev ownerOf returns a fixed owner; getAgentWallet reverts (older registries lack it).
contract OwnerOnlyIdentity {
    address internal immutable _owner;

    constructor(address o) {
        _owner = o;
    }

    function ownerOf(uint256) external view returns (address) {
        return _owner;
    }

    function getAgentWallet(uint256) external pure returns (address) {
        revert("no wallet");
    }
}
