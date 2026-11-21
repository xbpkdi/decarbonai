// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DCO2} from "./DCO2.sol";
import {CarbonReceipt} from "./CarbonReceipt.sol";
import {ICarbonReputation} from "./interfaces/IERC8004Reputation.sol";

/// @title RetirementPool: carbon settlement for x402-metered agent calls
/// @notice A meter (the x402 middleware, holding METER_ROLE) reports each settled paid call:
///         who paid, how much CO2e the call is estimated at, under which methodology, and the
///         x402 payment id. The meter forwards the carbon surcharge (payment token, e.g. USDC) into
///         the pool in the same call. Each payer has an account; when its pending accrual reaches
///         `thresholdMg`, the pool burns that much DCO2 and mints a soulbound CarbonReceipt to the
///         payer, then (if the payer is linked to an ERC-8004 agent) writes "carbon-settled" feedback.
/// @dev Trust model (v0): the pool cannot see the x402 transfer itself, so the meter is trusted to
///      report honestly; payment ids are deduplicated so one payment is never counted twice.
///      Surcharge USDC accumulates here and is withdrawn by TREASURY_ROLE to buy the next real tonne.
contract RetirementPool is AccessControl, Pausable, ReentrancyGuard, ERC1155Holder {
    using SafeERC20 for IERC20;

    bytes32 public constant METER_ROLE = keccak256("METER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant MG_PER_TONNE = 1e9;

    struct Account {
        uint256 agentId; // ERC-8004 agent id linked to this payer (0 = none)
        uint256 pendingMg; // accrued but not yet retired
        uint256 totalMg; // all-time accrued
        uint256 retiredMg; // all-time retired
        uint256 surchargePaid; // all-time payment-token units
        uint64 calls; // all-time metered calls
        uint64 pendingCalls; // calls since last retirement
        uint64 receipts; // receipts minted
        bytes32 lastMethodology;
    }

    struct Methodology {
        bool active;
        string version;
    }

    IERC20 public immutable paymentToken;
    DCO2 public immutable dco2;
    CarbonReceipt public immutable receipt;
    ICarbonReputation public reputation;

    uint256 public thresholdMg; // retirement batch size per account, e.g. 1e6 = 1 kg
    uint256 public pricePerTonne; // payment-token units per tonne CO2e (minimum surcharge)
    uint256 public maxMgPerAccrual; // sanity cap on a single reported call
    uint8 public maxRetirementsPerCall; // bounds gas of auto-retirement inside accrue()

    uint256[] public lotQueue; // DCO2 lots the pool retires from, in order
    uint256 public lotCursor;

    mapping(address payer => Account) private _accounts;
    mapping(bytes32 paymentId => bool) public paymentSeen;
    mapping(bytes32 hash => Methodology) private _methodologies;

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
    event ReputationRecorded(uint256 indexed agentId, uint256 indexed receiptId);
    event ReputationFailed(uint256 indexed agentId, uint256 indexed receiptId);
    event MethodologySet(bytes32 indexed hash, string version, bool active);
    event LotAdded(uint256 indexed lotId);
    event ThresholdSet(uint256 thresholdMg);
    event PriceSet(uint256 pricePerTonne);
    event LimitsSet(uint256 maxMgPerAccrual, uint8 maxRetirementsPerCall);
    event ReputationSet(address indexed reputation);
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroValue();
    error DuplicatePayment(bytes32 paymentId);
    error UnknownMethodology(bytes32 hash);
    error SurchargeTooLow(uint256 required, uint256 provided);
    error AccrualTooLarge(uint256 mgCO2e, uint256 max);
    error AgentMismatch(uint256 linked, uint256 provided);
    error BelowThreshold(uint256 pendingMg, uint256 thresholdMg);
    error NoSupply();
    error EmptyLot(uint256 lotId);

    struct Config {
        address admin;
        IERC20 paymentToken;
        DCO2 dco2;
        CarbonReceipt receipt;
        uint256 thresholdMg;
        uint256 pricePerTonne;
        uint256 maxMgPerAccrual;
        uint8 maxRetirementsPerCall;
    }

    constructor(Config memory c) {
        if (c.thresholdMg == 0 || c.maxMgPerAccrual == 0 || c.maxRetirementsPerCall == 0) revert ZeroValue();
        paymentToken = c.paymentToken;
        dco2 = c.dco2;
        receipt = c.receipt;
        thresholdMg = c.thresholdMg;
        pricePerTonne = c.pricePerTonne;
        maxMgPerAccrual = c.maxMgPerAccrual;
        maxRetirementsPerCall = c.maxRetirementsPerCall;
        _grantRole(DEFAULT_ADMIN_ROLE, c.admin);
        _grantRole(TREASURY_ROLE, c.admin);
        _grantRole(PAUSER_ROLE, c.admin);
        emit ThresholdSet(c.thresholdMg);
        emit PriceSet(c.pricePerTonne);
        emit LimitsSet(c.maxMgPerAccrual, c.maxRetirementsPerCall);
    }

    // ---------------------------------------------------------------- metering

    /// @notice Minimum surcharge (payment-token units) for `mgCO2e`, rounded up.
    function quote(uint256 mgCO2e) public view returns (uint256) {
        return Math.mulDiv(mgCO2e, pricePerTonne, MG_PER_TONNE, Math.Rounding.Ceil);
    }

    /// @notice Record one settled x402 call and pull its carbon surcharge from the meter.
    /// @param paymentId Unique id of the source x402 payment (e.g. keccak(payer, EIP-3009 nonce)).
    /// @param payer Address that paid for the call; receives receipts.
    /// @param agentId ERC-8004 agent id of the payer, or 0. Links on first use; cannot change.
    /// @param mgCO2e Estimated emissions of the call in milligrams CO2e.
    /// @param surcharge Payment-token units transferred from msg.sender; must be >= quote(mgCO2e).
    /// @param methodologyHash Registered hash of the factor set used for the estimate.
    function accrue(
        bytes32 paymentId,
        address payer,
        uint256 agentId,
        uint256 mgCO2e,
        uint256 surcharge,
        bytes32 methodologyHash
    ) external onlyRole(METER_ROLE) whenNotPaused nonReentrant {
        if (paymentId == bytes32(0) || payer == address(0) || mgCO2e == 0) revert ZeroValue();
        if (paymentSeen[paymentId]) revert DuplicatePayment(paymentId);
        if (!_methodologies[methodologyHash].active) revert UnknownMethodology(methodologyHash);
        if (mgCO2e > maxMgPerAccrual) revert AccrualTooLarge(mgCO2e, maxMgPerAccrual);
        uint256 required = quote(mgCO2e);
        if (surcharge < required) revert SurchargeTooLow(required, surcharge);

        paymentSeen[paymentId] = true;

        Account storage a = _accounts[payer];
        if (agentId != 0) {
            if (a.agentId == 0) {
                a.agentId = agentId;
                emit AgentLinked(payer, agentId);
            } else if (a.agentId != agentId) {
                revert AgentMismatch(a.agentId, agentId);
            }
        }

        a.pendingMg += mgCO2e;
        a.totalMg += mgCO2e;
        a.surchargePaid += surcharge;
        a.calls += 1;
        a.pendingCalls += 1;
        a.lastMethodology = methodologyHash;

        totalAccruedMg += mgCO2e;
        totalSurcharge += surcharge;
        totalAccruals += 1;

        if (surcharge > 0) paymentToken.safeTransferFrom(msg.sender, address(this), surcharge);

        emit CarbonAccrued(paymentId, payer, a.agentId, mgCO2e, surcharge, methodologyHash, a.pendingMg);

        _retireUpTo(payer, a);
    }

    /// @notice Retire any full batches pending for `payer`. Callable by anyone (e.g. after new
    ///         DCO2 supply arrives or when a burst exceeded maxRetirementsPerCall).
    function retire(address payer) external whenNotPaused nonReentrant returns (uint256 retired) {
        Account storage a = _accounts[payer];
        if (a.pendingMg < thresholdMg) revert BelowThreshold(a.pendingMg, thresholdMg);
        retired = _retireUpTo(payer, a);
        if (retired == 0) revert NoSupply();
    }

    function _retireUpTo(address payer, Account storage a) internal returns (uint256 count) {
        uint256 batch = thresholdMg;
        while (a.pendingMg >= batch && count < maxRetirementsPerCall) {
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
        uint64 covered = a.pendingCalls;
        a.pendingMg -= batch;
        a.retiredMg += batch;
        a.pendingCalls = 0;
        a.receipts += 1;
        totalRetiredMg += batch;
        totalRetirements += 1;

        dco2.retire(address(this), lotId, batch);
        uint256 agentId = a.agentId;
        uint256 receiptId = receipt.mint(
            CarbonReceipt.Retirement({
                beneficiary: payer,
                agentId: agentId,
                lotId: lotId,
                mgCO2e: batch,
                surchargePaid: a.surchargePaid,
                accrualCount: covered,
                retiredAt: uint64(block.timestamp),
                methodologyHash: a.lastMethodology
            })
        );
        emit Retired(receiptId, payer, agentId, lotId, batch, covered);

        ICarbonReputation rep = reputation;
        if (agentId != 0 && address(rep) != address(0)) {
            bytes32 feedbackHash = keccak256(abi.encode(block.chainid, address(receipt), receiptId, payer, batch));
            try rep.recordCarbonSettled(agentId, receiptId, batch, feedbackHash) {
                emit ReputationRecorded(agentId, receiptId);
            } catch {
                emit ReputationFailed(agentId, receiptId);
            }
        }
    }

    /// @dev First queued lot holding at least `amount`; skips (permanently) lots that can't cover it.
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

    // ---------------------------------------------------------------- admin

    function setMethodology(bytes32 hash, string calldata version, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (hash == bytes32(0)) revert ZeroValue();
        _methodologies[hash] = Methodology({active: active, version: version});
        emit MethodologySet(hash, version, active);
    }

    /// @notice Queue a DCO2 lot already held by the pool for retirement.
    function addLot(uint256 lotId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (dco2.balanceOf(address(this), lotId) == 0) revert EmptyLot(lotId);
        lotQueue.push(lotId);
        emit LotAdded(lotId);
    }

    function setThreshold(uint256 thresholdMg_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (thresholdMg_ == 0) revert ZeroValue();
        thresholdMg = thresholdMg_;
        emit ThresholdSet(thresholdMg_);
    }

    function setPricePerTonne(uint256 price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pricePerTonne = price;
        emit PriceSet(price);
    }

    function setLimits(uint256 maxMgPerAccrual_, uint8 maxRetirementsPerCall_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (maxMgPerAccrual_ == 0 || maxRetirementsPerCall_ == 0) revert ZeroValue();
        maxMgPerAccrual = maxMgPerAccrual_;
        maxRetirementsPerCall = maxRetirementsPerCall_;
        emit LimitsSet(maxMgPerAccrual_, maxRetirementsPerCall_);
    }

    function setReputation(ICarbonReputation rep) external onlyRole(DEFAULT_ADMIN_ROLE) {
        reputation = rep;
        emit ReputationSet(address(rep));
    }

    /// @notice Move collected surcharge to the treasury that buys the next real tonne.
    function withdraw(address to, uint256 amount) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (to == address(0) || amount == 0) revert ZeroValue();
        paymentToken.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
