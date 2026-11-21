// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DCO2} from "./DCO2.sol";
import {CarbonReceipt} from "./CarbonReceipt.sol";
import {ICarbonReputation, IERC8004Identity} from "./interfaces/IERC8004Reputation.sol";

/// @title RetirementPool: carbon settlement for x402-metered agent calls
/// @notice A meter (the x402 middleware, holding METER_ROLE) reports settled paid calls in batches:
///         who paid, how much CO2e each call is estimated at, under which methodology, and the
///         x402 payment id. The carbon surcharge (payment token, e.g. USDC) is pulled into the pool in
///         the same tx from the meter's configured funder (the merchant payTo wallet). Each payer has
///         an account; when its pending accrual reaches `thresholdMg`, the pool burns that much DCO2
///         and mints a soulbound CarbonReceipt to the payer. If the burned lot is backed by a real
///         off-chain retirement and the payer controls an ERC-8004 agent, it also writes
///         "carbon-settled" feedback to the agent's reputation.
/// @dev Trust model (v0): the pool cannot see the x402 transfer itself, so the meter is trusted to
///      report honestly. Its power is bounded: payment ids are deduplicated, each accrual is capped
///      (`maxMgPerAccrual`), all accruals share a rolling daily cap (`maxMgPerDay`), the price has an
///      immutable floor, agent links are checked against the ERC-8004 identity registry, and the
///      meter can never move pool funds (only TREASURY_ROLE can).
contract RetirementPool is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard, ERC1155Holder {
    using SafeERC20 for IERC20;

    bytes32 public constant METER_ROLE = keccak256("METER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant MG_PER_TONNE = 1e9;
    uint256 public constant MG_PER_KG = 1e6;
    uint256 public constant DAY = 1 days;
    /// @notice Gas that must remain before the reputation call, so a caller cannot starve it (63/64 rule)
    ///         and make the feedback fail while the retirement succeeds.
    uint256 public constant MIN_FEEDBACK_GAS = 400_000;

    struct Account {
        uint256 agentId; // ERC-8004 agent id linked to this payer (0 = none)
        uint256 pendingMg; // accrued but not yet retired
        uint256 totalMg; // all-time accrued
        uint256 retiredMg; // all-time retired
        uint256 surchargePaid; // all-time payment-token units
        uint256 pendingSurcharge; // payment-token units since the last retirement
        uint64 calls; // all-time metered calls
        uint64 pendingCalls; // calls since last retirement
        uint64 receipts; // receipts minted
        bytes32 lastMethodology;
    }

    struct Methodology {
        bool active;
        string version;
    }

    struct Accrual {
        bytes32 paymentId; // unique id of the source x402 payment
        address payer; // address that paid for the call; receives receipts
        uint256 agentId; // claimed ERC-8004 agent id of the payer, or 0
        uint256 mgCO2e; // estimated emissions of the call, milligrams CO2e
        uint256 surcharge; // payment-token units; must be >= quote(mgCO2e)
        bytes32 methodologyHash; // registered hash of the factor set used
    }

    IERC20 public immutable paymentToken;
    DCO2 public immutable dco2;
    CarbonReceipt public immutable receipt;
    IERC8004Identity public immutable identityRegistry; // address(0) disables the on-chain link check
    uint256 public immutable minPricePerTonne;
    ICarbonReputation public reputation;

    uint256 public thresholdMg; // retirement batch size per account; must divide 1 kg
    uint256 public pricePerTonne; // payment-token units per tonne CO2e (minimum surcharge)
    uint256 public maxMgPerAccrual; // cap on a single reported call
    uint256 public maxMgPerDay; // cap on all accruals in a rolling 24h window
    uint8 public maxRetirementsPerCall; // bounds retirement gas inside one tx

    uint256 public windowStart;
    uint256 public windowMg;

    uint256[] public lotQueue; // DCO2 lots the pool retires from, in order
    uint256 public lotCursor;

    mapping(address payer => Account) private _accounts;
    mapping(bytes32 paymentId => bool) public paymentSeen;
    mapping(bytes32 hash => Methodology) private _methodologies;
    mapping(address meter => address) public surchargeFunder; // 0 => the meter pays itself
    mapping(uint256 receiptId => bool) public feedbackPending;

    uint256 public totalAccruedMg;
    uint256 public totalRetiredMg;
    uint256 public totalSurcharge;
    uint256 public totalAccruals;
    uint256 public totalRetirements;

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
    event AgentLinked(address indexed payer, uint256 indexed agentId);
    event AgentLinkRejected(address indexed payer, uint256 indexed agentId);
    event ReputationRecorded(uint256 indexed agentId, uint256 indexed receiptId);
    event ReputationFailed(uint256 indexed agentId, uint256 indexed receiptId);
    event MethodologySet(bytes32 indexed hash, string version, bool active);
    event LotAdded(uint256 indexed lotId);
    event ThresholdSet(uint256 thresholdMg);
    event PriceSet(uint256 pricePerTonne);
    event LimitsSet(uint256 maxMgPerAccrual, uint256 maxMgPerDay, uint8 maxRetirementsPerCall);
    event ReputationSet(address indexed reputation);
    event SurchargeFunderSet(address indexed meter, address indexed funder);
    event Withdrawn(address indexed to, uint256 amount);
    event Rescued(address indexed token, uint256 indexed id, address indexed to, uint256 amount);

    error ZeroValue();
    error EmptyBatch();
    error DuplicatePayment(bytes32 paymentId);
    error UnknownMethodology(bytes32 hash);
    error SurchargeTooLow(uint256 required, uint256 provided);
    error AccrualTooLarge(uint256 mgCO2e, uint256 max);
    error DailyCapExceeded(uint256 windowMg, uint256 maxMgPerDay);
    error PriceBelowFloor(uint256 price, uint256 floor);
    error BadThreshold(uint256 thresholdMg);
    error BelowThreshold(uint256 pendingMg, uint256 thresholdMg);
    error NoSupply();
    error EmptyLot(uint256 lotId);
    error InsufficientGasForFeedback();
    error NoPendingFeedback(uint256 receiptId);
    error UsePaymentWithdraw();

    struct Config {
        address admin;
        uint48 adminDelay; // AccessControlDefaultAdminRules delay for future admin changes
        IERC20 paymentToken;
        DCO2 dco2;
        CarbonReceipt receipt;
        IERC8004Identity identityRegistry;
        uint256 thresholdMg;
        uint256 minPricePerTonne;
        uint256 pricePerTonne;
        uint256 maxMgPerAccrual;
        uint256 maxMgPerDay;
        uint8 maxRetirementsPerCall;
    }

    constructor(Config memory c) AccessControlDefaultAdminRules(c.adminDelay, c.admin) {
        if (c.maxMgPerAccrual == 0 || c.maxMgPerDay == 0 || c.maxRetirementsPerCall == 0) revert ZeroValue();
        _checkThreshold(c.thresholdMg);
        if (c.pricePerTonne < c.minPricePerTonne) revert PriceBelowFloor(c.pricePerTonne, c.minPricePerTonne);
        paymentToken = c.paymentToken;
        dco2 = c.dco2;
        receipt = c.receipt;
        identityRegistry = c.identityRegistry;
        minPricePerTonne = c.minPricePerTonne;
        thresholdMg = c.thresholdMg;
        pricePerTonne = c.pricePerTonne;
        maxMgPerAccrual = c.maxMgPerAccrual;
        maxMgPerDay = c.maxMgPerDay;
        maxRetirementsPerCall = c.maxRetirementsPerCall;
        windowStart = block.timestamp;
        _grantRole(TREASURY_ROLE, c.admin);
        _grantRole(PAUSER_ROLE, c.admin);
        emit ThresholdSet(c.thresholdMg);
        emit PriceSet(c.pricePerTonne);
        emit LimitsSet(c.maxMgPerAccrual, c.maxMgPerDay, c.maxRetirementsPerCall);
    }

    // ---------------------------------------------------------------- metering

    /// @notice Minimum surcharge (payment-token units) for `mgCO2e`, rounded up.
    function quote(uint256 mgCO2e) public view returns (uint256) {
        return Math.mulDiv(mgCO2e, pricePerTonne, MG_PER_TONNE, Math.Rounding.Ceil);
    }

    /// @notice Record one settled x402 call. Reverts on a duplicate payment id.
    function accrue(
        bytes32 paymentId,
        address payer,
        uint256 agentId,
        uint256 mgCO2e,
        uint256 surcharge,
        bytes32 methodologyHash
    ) external onlyRole(METER_ROLE) whenNotPaused nonReentrant {
        if (paymentSeen[paymentId]) revert DuplicatePayment(paymentId);
        uint256 budget = maxRetirementsPerCall;
        _accrue(Accrual(paymentId, payer, agentId, mgCO2e, surcharge, methodologyHash), budget);
        _pullSurcharge(surcharge);
    }

    /// @notice Record many settled x402 calls with one surcharge transfer. Already-seen payment ids
    ///         are skipped (AccrualSkipped), so a meter can safely resend a batch after a restart.
    ///         All retirements in the batch share one `maxRetirementsPerCall` budget.
    function accrueBatch(Accrual[] calldata items) external onlyRole(METER_ROLE) whenNotPaused nonReentrant {
        if (items.length == 0) revert EmptyBatch();
        uint256 budget = maxRetirementsPerCall;
        uint256 total = 0;
        for (uint256 i; i < items.length; ++i) {
            if (paymentSeen[items[i].paymentId]) {
                emit AccrualSkipped(items[i].paymentId);
                continue;
            }
            budget -= _accrue(items[i], budget);
            total += items[i].surcharge;
        }
        _pullSurcharge(total);
    }

    function _accrue(Accrual memory x, uint256 budget) internal returns (uint256 retired) {
        if (x.paymentId == bytes32(0) || x.payer == address(0) || x.mgCO2e == 0) revert ZeroValue();
        if (!_methodologies[x.methodologyHash].active) revert UnknownMethodology(x.methodologyHash);
        if (x.mgCO2e > maxMgPerAccrual) revert AccrualTooLarge(x.mgCO2e, maxMgPerAccrual);
        uint256 required = quote(x.mgCO2e);
        if (x.surcharge < required) revert SurchargeTooLow(required, x.surcharge);
        _useDailyCap(x.mgCO2e);

        paymentSeen[x.paymentId] = true;

        Account storage a = _accounts[x.payer];
        if (x.agentId != 0 && a.agentId != x.agentId) {
            if (a.agentId == 0 && _controlsAgent(x.payer, x.agentId)) {
                a.agentId = x.agentId;
                emit AgentLinked(x.payer, x.agentId);
            } else {
                emit AgentLinkRejected(x.payer, x.agentId);
            }
        }

        a.pendingMg += x.mgCO2e;
        a.totalMg += x.mgCO2e;
        a.surchargePaid += x.surcharge;
        a.pendingSurcharge += x.surcharge;
        a.calls += 1;
        a.pendingCalls += 1;
        a.lastMethodology = x.methodologyHash;

        totalAccruedMg += x.mgCO2e;
        totalSurcharge += x.surcharge;
        totalAccruals += 1;

        emit CarbonAccrued(x.paymentId, x.payer, a.agentId, x.mgCO2e, x.surcharge, x.methodologyHash, a.pendingMg);

        retired = _retireUpTo(x.payer, a, budget);
    }

    function _pullSurcharge(uint256 amount) internal {
        if (amount == 0) return;
        address funder = surchargeFunder[msg.sender];
        // `funder` is not caller-controlled: DEFAULT_ADMIN maps each meter to its merchant wallet, which
        // opts in by approving this pool. Funds only move into the pool, never out.
        // slither-disable-next-line arbitrary-send-erc20
        paymentToken.safeTransferFrom(funder == address(0) ? msg.sender : funder, address(this), amount);
    }

    function _useDailyCap(uint256 mg) internal {
        if (block.timestamp >= windowStart + DAY) {
            windowStart = block.timestamp;
            windowMg = 0;
        }
        uint256 used = windowMg + mg;
        if (used > maxMgPerDay) revert DailyCapExceeded(used, maxMgPerDay);
        windowMg = used;
    }

    /// @dev True if `payer` owns, or is the registered agent wallet of, ERC-8004 agent `agentId`.
    function _controlsAgent(address payer, uint256 agentId) internal view returns (bool) {
        IERC8004Identity id = identityRegistry;
        if (address(id) == address(0)) return true;
        try id.ownerOf(agentId) returns (address owner) {
            if (owner == payer) return true;
        } catch {
            return false;
        }
        try id.getAgentWallet(agentId) returns (address wallet) {
            return wallet == payer;
        } catch {
            return false;
        }
    }

    /// @notice Retire any full batches pending for `payer`. Callable by anyone (e.g. after new
    ///         DCO2 supply arrives or when a burst exceeded maxRetirementsPerCall).
    function retire(address payer) external whenNotPaused nonReentrant returns (uint256 retired) {
        Account storage a = _accounts[payer];
        if (a.pendingMg < thresholdMg) revert BelowThreshold(a.pendingMg, thresholdMg);
        retired = _retireUpTo(payer, a, maxRetirementsPerCall);
        if (retired == 0) revert NoSupply();
    }

    /// @dev Writes lotCursor after earlier iterations' external calls. Safe: every entry point is
    ///      nonReentrant and the callees are this deployment's own DCO2 / CarbonReceipt / adapter.
    // slither-disable-next-line reentrancy-no-eth
    function _retireUpTo(address payer, Account storage a, uint256 budget) internal returns (uint256 count) {
        uint256 batch = thresholdMg;
        while (a.pendingMg >= batch && count < budget) {
            (bool found, uint256 lotId) = _nextLot(batch);
            if (!found) {
                emit RetirementDeferred(payer, a.pendingMg);
                return count;
            }
            _retireOne(payer, a, lotId, batch);
            ++count;
        }
    }

    function _retireOne(address payer, Account storage a, uint256 lotId, uint256 batch) internal {
        CarbonReceipt.Retirement memory r = CarbonReceipt.Retirement({
            beneficiary: payer,
            agentId: a.agentId,
            lotId: lotId,
            mgCO2e: batch,
            surcharge: a.pendingSurcharge,
            accrualCount: a.pendingCalls,
            retiredAt: uint64(block.timestamp),
            methodologyHash: a.lastMethodology,
            backed: dco2.isBacked(lotId)
        });
        a.pendingMg -= batch;
        a.retiredMg += batch;
        a.pendingCalls = 0;
        a.pendingSurcharge = 0;
        a.receipts += 1;
        totalRetiredMg += batch;
        totalRetirements += 1;

        dco2.retire(address(this), lotId, batch);
        uint256 receiptId = receipt.mint(r);
        emit Retired(receiptId, payer, r.agentId, lotId, batch, r.accrualCount);

        // "carbon-settled" is only claimed when a real (backed) lot was burned.
        if (r.backed && r.agentId != 0 && address(reputation) != address(0)) _recordReputation(r, receiptId);
    }

    function _recordReputation(CarbonReceipt.Retirement memory r, uint256 receiptId) internal {
        if (gasleft() < MIN_FEEDBACK_GAS) revert InsufficientGasForFeedback();
        try reputation.recordCarbonSettled(
            r.agentId, receiptId, r.mgCO2e, _feedbackHash(receiptId, r.beneficiary, r.mgCO2e)
        ) {
            emit ReputationRecorded(r.agentId, receiptId);
        } catch {
            feedbackPending[receiptId] = true;
            emit ReputationFailed(r.agentId, receiptId);
        }
    }

    /// @notice Replay reputation feedback for a receipt whose feedback call failed. Anyone may call.
    function retryFeedback(uint256 receiptId) external nonReentrant {
        if (!feedbackPending[receiptId]) revert NoPendingFeedback(receiptId);
        feedbackPending[receiptId] = false;
        CarbonReceipt.Retirement memory r = receipt.retirement(receiptId);
        reputation.recordCarbonSettled(
            r.agentId, receiptId, r.mgCO2e, _feedbackHash(receiptId, r.beneficiary, r.mgCO2e)
        );
        emit ReputationRecorded(r.agentId, receiptId);
    }

    function _feedbackHash(uint256 receiptId, address payer, uint256 mg) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(receipt), receiptId, payer, mg));
    }

    /// @dev First queued lot holding at least `amount`; skips lots that can't cover it (re-queue with addLot).
    function _nextLot(uint256 amount) internal returns (bool, uint256) {
        uint256 len = lotQueue.length;
        uint256 i = lotCursor;
        while (i < len) {
            uint256 lotId = lotQueue[i];
            if (dco2.balanceOf(address(this), lotId) >= amount) {
                if (i != lotCursor) lotCursor = i;
                return (true, lotId);
            }
            ++i;
        }
        if (lotCursor != len) lotCursor = len;
        return (false, 0);
    }

    // ---------------------------------------------------------------- views

    function account(address payer) external view returns (Account memory) {
        return _accounts[payer];
    }

    function methodology(bytes32 hash) external view returns (Methodology memory) {
        return _methodologies[hash];
    }

    function lotQueueLength() external view returns (uint256) {
        return lotQueue.length;
    }

    /// @notice DCO2 (mg) the pool can still retire from the remaining lots.
    function availableSupply() external view returns (uint256 total) {
        uint256 len = lotQueue.length;
        for (uint256 i = lotCursor; i < len; ++i) {
            total += dco2.balanceOf(address(this), lotQueue[i]);
        }
    }

    /// @notice mg still accruable in the current daily window.
    function dailyCapRemaining() external view returns (uint256) {
        if (block.timestamp >= windowStart + DAY) return maxMgPerDay;
        return maxMgPerDay > windowMg ? maxMgPerDay - windowMg : 0;
    }

    // ---------------------------------------------------------------- admin

    function setMethodology(bytes32 hash, string calldata version, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hash == bytes32(0)) revert ZeroValue();
        _methodologies[hash] = Methodology({active: active, version: version});
        emit MethodologySet(hash, version, active);
    }

    /// @notice Queue a DCO2 lot held by the pool for retirement (may re-queue a skipped lot).
    function addLot(uint256 lotId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (dco2.balanceOf(address(this), lotId) == 0) revert EmptyLot(lotId);
        lotQueue.push(lotId);
        emit LotAdded(lotId);
    }

    /// @notice Batch size; must divide 1 kg so whole-kg lots never leave undeliverable dust.
    function setThreshold(uint256 thresholdMg_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _checkThreshold(thresholdMg_);
        thresholdMg = thresholdMg_;
        emit ThresholdSet(thresholdMg_);
    }

    function _checkThreshold(uint256 t) internal pure {
        if (t == 0 || MG_PER_KG % t != 0) revert BadThreshold(t);
    }

    function setPricePerTonne(uint256 price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (price < minPricePerTonne) revert PriceBelowFloor(price, minPricePerTonne);
        pricePerTonne = price;
        emit PriceSet(price);
    }

    function setLimits(uint256 maxMgPerAccrual_, uint256 maxMgPerDay_, uint8 maxRetirementsPerCall_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (maxMgPerAccrual_ == 0 || maxMgPerDay_ == 0 || maxRetirementsPerCall_ == 0) revert ZeroValue();
        maxMgPerAccrual = maxMgPerAccrual_;
        maxMgPerDay = maxMgPerDay_;
        maxRetirementsPerCall = maxRetirementsPerCall_;
        emit LimitsSet(maxMgPerAccrual_, maxMgPerDay_, maxRetirementsPerCall_);
    }

    function setReputation(ICarbonReputation rep) external onlyRole(DEFAULT_ADMIN_ROLE) {
        reputation = rep;
        emit ReputationSet(address(rep));
    }

    /// @notice Where `meter`'s surcharges are pulled from (the merchant payTo wallet, which must
    ///         approve this pool). address(0) = the meter itself.
    function setSurchargeFunder(address meter, address funder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (meter == address(0)) revert ZeroValue();
        surchargeFunder[meter] = funder;
        emit SurchargeFunderSet(meter, funder);
    }

    /// @notice Move collected surcharge to the treasury that buys the next real tonne.
    function withdraw(address to, uint256 amount) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (to == address(0) || amount == 0) revert ZeroValue();
        paymentToken.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Recover an ERC-20 sent here by mistake (not the payment token: use withdraw).
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (address(token) == address(paymentToken)) revert UsePaymentWithdraw();
        if (to == address(0) || amount == 0) revert ZeroValue();
        token.safeTransfer(to, amount);
        emit Rescued(address(token), 0, to, amount);
    }

    /// @notice Move ERC-1155 balances out (stray tokens, or DCO2 lot remainders to consolidate).
    function rescueERC1155(IERC1155 token, uint256 id, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (to == address(0) || amount == 0) revert ZeroValue();
        token.safeTransferFrom(address(this), to, id, amount, "");
        emit Rescued(address(token), id, to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlDefaultAdminRules, ERC1155Holder)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
