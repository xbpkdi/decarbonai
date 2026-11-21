// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC8004Reputation, ICarbonReputation} from "./interfaces/IERC8004Reputation.sol";

/// @title ERC8004ReputationAdapter
/// @notice Writes a "carbon-settled" feedback entry to the ERC-8004 Reputation Registry each time the
///         pool retires an agent's usage. This adapter is the feedback "client"; the registry rejects
///         feedback from the agent's own owner/operators, so the adapter must not own any agent.
/// @dev value = kilograms CO2e retired with 3 decimals (i.e. grams), tag1 = "carbon-settled",
///      tag2 = "dco2-retired", feedbackURI = "<receiptPrefix><receiptId>".
contract ERC8004ReputationAdapter is ICarbonReputation, Ownable {
    using Strings for uint256;

    string public constant TAG1 = "carbon-settled";
    string public constant TAG2 = "dco2-retired";

    IERC8004Reputation public immutable registry;
    address public pool;
    string public receiptURIPrefix;

    event PoolSet(address indexed pool);
    event CarbonFeedbackGiven(uint256 indexed agentId, uint256 indexed receiptId, uint256 mgCO2e);

    error NotPool();
    error ZeroAddress();

    constructor(address owner_, IERC8004Reputation registry_, string memory receiptURIPrefix_) Ownable(owner_) {
        registry = registry_;
        receiptURIPrefix = receiptURIPrefix_;
    }

    function setPool(address pool_) external onlyOwner {
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
        emit PoolSet(pool_);
    }

    function setReceiptURIPrefix(string calldata prefix) external onlyOwner {
        receiptURIPrefix = prefix;
    }

    function recordCarbonSettled(uint256 agentId, uint256 receiptId, uint256 mgCO2e, bytes32 feedbackHash) external {
        if (msg.sender != pool) revert NotPool();
        registry.giveFeedback(
            agentId,
            int128(int256(mgCO2e / 1000)),
            3,
            TAG1,
            TAG2,
            "",
            string.concat(receiptURIPrefix, receiptId.toString()),
            feedbackHash
        );
        emit CarbonFeedbackGiven(agentId, receiptId, mgCO2e);
    }
}
