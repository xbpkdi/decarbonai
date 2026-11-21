// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev ERC-8004 IdentityRegistry subset: ownerOf reverts for unknown agents, like ERC-721.
contract MockIdentityRegistry {
    mapping(uint256 => address) internal _owners;
    mapping(uint256 => address) public getAgentWallet;

    function set(uint256 agentId, address owner, address wallet) external {
        _owners[agentId] = owner;
        getAgentWallet[agentId] = wallet;
    }

    function ownerOf(uint256 agentId) external view returns (address o) {
        o = _owners[agentId];
        require(o != address(0), "ERC721NonexistentToken");
    }
}

/// @dev Burns all gas it is given, to test the feedback gas floor.
contract GasBurnerReputation {
    function recordCarbonSettled(uint256, uint256, uint256, bytes32) external pure {
        while (true) {}
    }
}
