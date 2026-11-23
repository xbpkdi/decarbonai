// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Subset of the ERC-8004 ReputationRegistry deployed on Avalanche Fuji
///         (proxy 0x8004B663056A597Dffe9eCcC1965A193B7388713, verified impl ReputationRegistryUpgradeable).
interface IERC8004Reputation {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
}

/// @notice What the RetirementPool needs from a reputation sink.
interface ICarbonReputation {
    function recordCarbonSettled(uint256 agentId, uint256 receiptId, uint256 mgCO2e, bytes32 feedbackHash) external;
}

/// @notice Subset of the ERC-8004 IdentityRegistry used to check that a payer controls an agent.
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
}
