// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";
import {MockReputationRegistry} from "./mocks/MockReputationRegistry.sol";
import {ICarbonReputation} from "../src/interfaces/IERC8004Reputation.sol";

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

    // ------------------------------------------------------------ constructor / config

    function test_constructor_rejectsZeroConfig() public {
        RetirementPool.Config memory c = RetirementPool.Config({
            admin: admin,
            paymentToken: IERC20(address(usdc)),
            dco2: dco2,
            receipt: receipt,
            thresholdMg: 0,
            pricePerTonne: PRICE,
            maxMgPerAccrual: 1,
            maxRetirementsPerCall: 1
        });
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        new RetirementPool(c);
        c.thresholdMg = 1;
        c.maxMgPerAccrual = 0;
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        new RetirementPool(c);
        c.maxMgPerAccrual = 1;
        c.maxRetirementsPerCall = 0;
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        new RetirementPool(c);
    }

    function test_initialState() public view {
        assertEq(pool.thresholdMg(), KG);
        assertEq(pool.pricePerTonne(), PRICE);
        assertEq(address(pool.paymentToken()), address(usdc));
        assertEq(pool.lotQueueLength(), 1);
        assertEq(pool.availableSupply(), 1e9);
        assertTrue(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(pool.hasRole(pool.TREASURY_ROLE(), admin));
        assertTrue(pool.hasRole(pool.PAUSER_ROLE(), admin));
        assertTrue(pool.methodology(METHOD).active);
        assertEq(pool.methodology(METHOD).version, "v0-2026-08-anchored");
        assertTrue(pool.supportsInterface(0x4e2312e0)); // IERC1155Receiver
        assertTrue(pool.supportsInterface(type(IAccessControl).interfaceId));
    }

    // ------------------------------------------------------------ quote

    function test_quote_roundsUp() public view {
        assertEq(pool.quote(1e9), PRICE); // 1 t
        assertEq(pool.quote(1), 1); // tiny amounts still cost 1 unit
        assertEq(pool.quote(40), 1); // 40 mg * 25e6 / 1e9 = 1.0
        assertEq(pool.quote(41), 2);
    }

    function testFuzz_quote_neverUndercharges(uint128 mg, uint64 price) public {
        vm.prank(admin);
        pool.setPricePerTonne(price);
        uint256 q = pool.quote(mg);
        assertGe(q * 1e9, uint256(mg) * price);
        assertLt(q * 1e9, uint256(mg) * price + 1e9);
    }

    // ------------------------------------------------------------ accrue

    function test_accrue_recordsAndPullsSurcharge() public {
        uint256 mg = 22_000; // 22 g
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
        assertEq(a.retiredMg, 0);
        assertEq(a.surchargePaid, s);
        assertEq(a.calls, 1);
        assertEq(a.pendingCalls, 1);
        assertEq(a.lastMethodology, METHOD);
        assertEq(usdc.balanceOf(address(pool)), s);
        assertTrue(pool.paymentSeen(bytes32("p1")));
        assertEq(pool.totalAccruedMg(), mg);
        assertEq(pool.totalSurcharge(), s);
        assertEq(pool.totalAccruals(), 1);
    }

    function test_accrue_overpaymentAccepted() public {
        vm.prank(meter);
        pool.accrue(bytes32("p1"), agent, 0, 1000, 5e6, METHOD);
        assertEq(pool.account(agent).surchargePaid, 5e6);
    }

    function test_accrue_zeroPriceZeroSurcharge() public {
        vm.prank(admin);
        pool.setPricePerTonne(0);
        uint256 before = usdc.balanceOf(meter);
        vm.prank(meter);
        pool.accrue(bytes32("p1"), agent, 0, 1000, 0, METHOD);
        assertEq(usdc.balanceOf(meter), before);
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
        pool.accrue(bytes32("p1"), agent, 0, 1000, s, METHOD);
        // even for a different payer
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

    function test_accrue_agentLinkIsStickyAndChecked() public {
        _accrue(bytes32("p1"), agent, 0, 1000);
        assertEq(pool.account(agent).agentId, 0);
        _accrue(bytes32("p2"), agent, AGENT_ID, 1000);
        assertEq(pool.account(agent).agentId, AGENT_ID);
        // agentId 0 later keeps the link
        _accrue(bytes32("p3"), agent, 0, 1000);
        assertEq(pool.account(agent).agentId, AGENT_ID);
        uint256 s = pool.quote(1000);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.AgentMismatch.selector, AGENT_ID, 7));
        vm.prank(meter);
        pool.accrue(bytes32("p4"), agent, 7, 1000, s, METHOD);
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

    function test_accrue_meterWithoutFundsReverts() public {
        address poorMeter = makeAddr("poor");
        bytes32 role = pool.METER_ROLE();
        vm.prank(admin);
        pool.grantRole(role, poorMeter);
        vm.expectRevert();
        vm.prank(poorMeter);
        pool.accrue(bytes32("p"), agent, 0, KG, 1e6, METHOD);
    }

    // ------------------------------------------------------------ auto retirement

    function test_autoRetire_atThreshold() public {
        _accrue(bytes32("p1"), agent, AGENT_ID, KG / 2);
        assertEq(receipt.balanceOf(agent), 0);

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
        assertEq(pool.totalRetiredMg(), KG);
        assertEq(pool.totalRetirements(), 1);
        assertEq(dco2.balanceOf(address(pool), 1), 1e9 - KG);
        assertEq(dco2.totalSupply(1), 1e9 - KG);

        assertEq(receipt.ownerOf(1), agent);
        assertTrue(receipt.locked(1));
        CarbonReceipt.Retirement memory r = receipt.retirement(1);
        assertEq(r.beneficiary, agent);
        assertEq(r.agentId, AGENT_ID);
        assertEq(r.lotId, 1);
        assertEq(r.mgCO2e, KG);
        assertEq(r.accrualCount, 2);
        assertEq(r.surchargePaid, 2 * s);
        assertEq(r.methodologyHash, METHOD);
        assertEq(r.retiredAt, block.timestamp);

        assertEq(registry.entryCount(), 1);
        MockReputationRegistry.Entry memory e = registry.entry(0);
        assertEq(e.agentId, AGENT_ID);
        assertEq(e.client, address(adapter));
        assertEq(e.value, 1000); // 1.000 kg
        assertEq(e.decimals, 3);
        assertEq(e.tag1, "carbon-settled");
        assertEq(e.tag2, "dco2-retired");
        assertEq(e.feedbackURI, "dcrcpt:1");
    }

    function test_autoRetire_multipleBatchesKeepsRemainder() public {
        _accrue(bytes32("p1"), agent, 0, 3 * KG + 123);
        RetirementPool.Account memory a = pool.account(agent);
        assertEq(a.receipts, 3);
        assertEq(a.pendingMg, 123);
        assertEq(receipt.balanceOf(agent), 3);
        // only the first receipt covers the call; later ones cover 0 new calls
        assertEq(receipt.retirement(1).accrualCount, 1);
        assertEq(receipt.retirement(2).accrualCount, 0);
        // no agent => no reputation
        assertEq(registry.entryCount(), 0);
    }

    function test_autoRetire_boundedPerCall_thenManualRetire() public {
        _accrue(bytes32("p1"), agent, 0, 7 * KG);
        assertEq(pool.account(agent).receipts, 5); // maxRetirementsPerCall
        assertEq(pool.account(agent).pendingMg, 2 * KG);
        vm.prank(makeAddr("anyone"));
        assertEq(pool.retire(agent), 2);
        assertEq(pool.account(agent).pendingMg, 0);
        assertEq(receipt.balanceOf(agent), 7);
    }

    function test_retire_belowThresholdReverts() public {
        _accrue(bytes32("p1"), agent, 0, KG - 1);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.BelowThreshold.selector, KG - 1, KG));
        pool.retire(agent);
    }

    function test_retire_whenPausedReverts() public {
        vm.prank(admin);
        pool.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.retire(agent);
    }

    function test_noSupply_defersThenRetiresAfterRestock() public {
        // drain the single 1 t lot exactly: 1000 kg in 200 accruals of 5 kg
        vm.startPrank(admin);
        pool.setLimits(1_000_000 * KG, 255);
        vm.stopPrank();
        _accrue(bytes32("drain"), makeAddr("whale"), 0, 1000 * KG); // 255 retire, rest pending
        vm.prank(makeAddr("anyone"));
        pool.retire(makeAddr("whale"));
        vm.prank(makeAddr("anyone"));
        pool.retire(makeAddr("whale"));
        vm.prank(makeAddr("anyone"));
        pool.retire(makeAddr("whale"));
        assertEq(pool.availableSupply(), 1e9 - 1000 * KG + 0); // 0 left
        assertEq(pool.availableSupply(), 0);

        uint256 s = pool.quote(KG);
        vm.expectEmit(address(pool));
        emit RetirementDeferred(agent, KG);
        vm.prank(meter);
        pool.accrue(bytes32("p1"), agent, 0, KG, s, METHOD);
        assertEq(pool.account(agent).pendingMg, KG);
        assertEq(pool.lotCursor(), 1);

        vm.expectRevert(RetirementPool.NoSupply.selector);
        pool.retire(agent);

        vm.prank(admin);
        uint256 lot2 = dco2.mintLot(address(pool), _lot("SERIAL-2", 1));
        vm.prank(admin);
        pool.addLot(lot2);
        assertEq(pool.retire(agent), 1);
        assertEq(receipt.retirement(receipt.nextId() - 1).lotId, lot2);
    }

    function test_lotSkipsWhenRemainderTooSmall() public {
        // threshold 600 g: lot 1 (1 t) leaves 400 g dust after 1666 batches; use small custom lots instead
        vm.startPrank(admin);
        pool.setThreshold(600 * 1000 * 1000); // 600 kg
        uint256 lot2 = _mintLot("SERIAL-2", 1);
        vm.stopPrank();
        _accrue(bytes32("a"), agent, 0, 600 * KG); // lot1 -> 400 kg left
        assertEq(receipt.retirement(1).lotId, 1);
        _accrue(bytes32("b"), agent, 0, 600 * KG); // lot1 too small, skip to lot2
        assertEq(receipt.retirement(2).lotId, lot2);
        assertEq(pool.lotCursor(), 1);
        assertEq(pool.availableSupply(), 400 * KG); // lot1 dust no longer counted
    }

    function test_reputationFailureDoesNotBlockRetirement() public {
        registry.setBroken(true);
        uint256 s = pool.quote(KG);
        vm.expectEmit(address(pool));
        emit ReputationFailed(AGENT_ID, 1);
        vm.prank(meter);
        pool.accrue(bytes32("p"), agent, AGENT_ID, KG, s, METHOD);
        assertEq(receipt.balanceOf(agent), 1);
    }

    function test_reputationSelfFeedbackRejected_isCaught() public {
        // if the adapter itself owned the agent, the registry would refuse; pool must still settle
        registry.setOwner(AGENT_ID, address(adapter));
        _accrue(bytes32("p"), agent, AGENT_ID, KG);
        assertEq(receipt.balanceOf(agent), 1);
        assertEq(registry.entryCount(), 0);
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
        pool.setPricePerTonne(1);
        vm.expectRevert(err);
        pool.setLimits(1, 1);
        vm.expectRevert(err);
        pool.setReputation(ICarbonReputation(address(0)));
        vm.expectRevert(err);
        pool.setMethodology(METHOD, "", true);
        vm.expectRevert(err);
        pool.addLot(1);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, x, pool.TREASURY_ROLE())
        );
        pool.withdraw(x, 1);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, x, pool.PAUSER_ROLE())
        );
        pool.pause();
        vm.stopPrank();
    }

    function test_admin_setters() public {
        vm.startPrank(admin);
        pool.setThreshold(5);
        assertEq(pool.thresholdMg(), 5);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setThreshold(0);
        pool.setLimits(10, 2);
        assertEq(pool.maxMgPerAccrual(), 10);
        assertEq(pool.maxRetirementsPerCall(), 2);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setLimits(0, 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setLimits(1, 0);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.setMethodology(bytes32(0), "x", true);
        vm.expectRevert(abi.encodeWithSelector(RetirementPool.EmptyLot.selector, 99));
        pool.addLot(99);
        vm.stopPrank();
    }

    function test_withdraw() public {
        _accrue(bytes32("p"), agent, 0, 500 * KG);
        uint256 bal = usdc.balanceOf(address(pool));
        address treasury = makeAddr("treasury");
        vm.startPrank(admin);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.withdraw(address(0), 1);
        vm.expectRevert(RetirementPool.ZeroValue.selector);
        pool.withdraw(treasury, 0);
        pool.withdraw(treasury, bal);
        vm.stopPrank();
        assertEq(usdc.balanceOf(treasury), bal);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    // ------------------------------------------------------------ fuzz

    /// @dev Conservation: accrued = retired + pending, retired = receipts * threshold = DCO2 burned.
    function testFuzz_accrueSequence_conserves(uint32[12] memory amounts, uint24 threshold) public {
        threshold = uint24(bound(threshold, 100_000, 5 * KG));
        vm.startPrank(admin);
        pool.setThreshold(threshold);
        pool.setLimits(100 * KG, 32);
        // lot 1 (1 t) can leave dust < threshold; a 10 t lot backs the rest
        uint256 lot2 = _mintLot("BIG", 10);
        vm.stopPrank();

        uint256 sum;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 mg = bound(amounts[i], 1, 20 * uint256(threshold));
            sum += mg;
            _accrue(keccak256(abi.encode(i)), agent, AGENT_ID, mg);
        }
        RetirementPool.Account memory a = pool.account(agent);
        assertEq(a.totalMg, sum);
        assertEq(a.retiredMg + a.pendingMg, sum);
        assertLt(a.pendingMg, threshold);
        assertEq(a.retiredMg, uint256(a.receipts) * threshold);
        assertEq(receipt.balanceOf(agent), a.receipts);
        assertEq(dco2.totalSupply(1) + dco2.totalSupply(lot2), 11e9 - a.retiredMg);
        assertEq(registry.entryCount(), a.receipts);
        assertEq(a.calls, amounts.length);
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

    function testFuzz_accrue_multiplePayersIsolated(address p1, address p2, uint32 m1, uint32 m2) public {
        vm.assume(p1 != address(0) && p2 != address(0) && p1 != p2);
        vm.assume(p1.code.length == 0 && p2.code.length == 0);
        m1 = uint32(bound(m1, 1, 3 * KG));
        m2 = uint32(bound(m2, 1, 3 * KG));
        _accrue(bytes32("a"), p1, 0, m1);
        _accrue(bytes32("b"), p2, 0, m2);
        assertEq(pool.account(p1).totalMg, m1);
        assertEq(pool.account(p2).totalMg, m2);
        assertEq(pool.account(p1).pendingMg, m1 % KG);
        assertEq(pool.account(p2).pendingMg, m2 % KG);
        assertEq(pool.totalAccruedMg(), uint256(m1) + m2);
    }
}
