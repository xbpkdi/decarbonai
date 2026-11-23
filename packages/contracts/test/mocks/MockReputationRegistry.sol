// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Mirrors the parts of ERC-8004 ReputationRegistryUpgradeable the adapter relies on.
contract MockReputationRegistry {
    struct Entry {
        uint256 agentId;
        address client;
        int128 value;
        uint8 decimals;
        string tag1;
        string tag2;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    mapping(uint256 agentId => address) public ownerOf;
    mapping(uint256 => mapping(address => uint64)) public lastIndex;
    Entry[] internal entries;
    bool public broken;

    function setOwner(uint256 agentId, address owner) external {
        ownerOf[agentId] = owner;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string memory tag1,
        string memory tag2,
        string memory,
        string memory feedbackURI,
        bytes32 feedbackHash
    ) external {
        require(!broken, "broken");
        require(ownerOf[agentId] != address(0), "ERC721NonexistentToken");
        require(ownerOf[agentId] != msg.sender, "Self-feedback not allowed");
        ++lastIndex[agentId][msg.sender];
        entries.push(Entry(agentId, msg.sender, value, valueDecimals, tag1, tag2, feedbackURI, feedbackHash));
    }

    function getLastIndex(uint256 agentId, address client) external view returns (uint64) {
        return lastIndex[agentId][client];
    }

    function entry(uint256 i) external view returns (Entry memory) {
        return entries[i];
    }

    function entryCount() external view returns (uint256) {
        return entries.length;
    }
}
