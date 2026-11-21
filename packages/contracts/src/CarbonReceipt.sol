// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IERC5192} from "./interfaces/IERC5192.sol";

/// @title CarbonReceipt: soulbound retirement receipt (ERC-721 + ERC-5192)
/// @notice One token per retirement. Minted only by the RetirementPool to the agent/payer whose
///         metered usage was retired. Tokens are permanently locked (cannot be transferred or approved).
contract CarbonReceipt is ERC721, Ownable, IERC5192 {
    using Strings for uint256;
    using Strings for address;

    struct Retirement {
        address beneficiary; // payer whose accrued usage was retired
        uint256 agentId; // ERC-8004 agent id, 0 if none
        uint256 lotId; // DCO2 lot burned
        uint256 mgCO2e; // amount burned
        uint256 surchargePaid; // payment-token units paid by this account up to this retirement
        uint64 accrualCount; // metered calls covered since the previous retirement
        uint64 retiredAt;
        bytes32 methodologyHash; // methodology of the last accrual in the batch
    }

    address public minter;
    uint256 public nextId = 1;
    mapping(uint256 tokenId => Retirement) private _retirements;

    event MinterSet(address indexed minter);

    error NotMinter();
    error Soulbound();
    error ZeroAddress();

    constructor(address owner_) ERC721("DecarbonAI Carbon Receipt", "DCRCPT") Ownable(owner_) {}

    /// @notice Set once at deploy time to the RetirementPool; the owner can rotate it.
    function setMinter(address minter_) external onlyOwner {
        if (minter_ == address(0)) revert ZeroAddress();
        minter = minter_;
        emit MinterSet(minter_);
    }

    function mint(Retirement calldata r) external returns (uint256 tokenId) {
        if (msg.sender != minter) revert NotMinter();
        tokenId = nextId++;
        _retirements[tokenId] = r;
        _mint(r.beneficiary, tokenId); // not _safeMint: a reverting receiver must not block accrual
        emit Locked(tokenId);
    }

    function retirement(uint256 tokenId) external view returns (Retirement memory) {
        _requireOwned(tokenId);
        return _retirements[tokenId];
    }

    /// @inheritdoc IERC5192
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    /// @dev Only mints (from == 0) are allowed. Burns are not exposed.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Retirement storage r = _retirements[tokenId];
        string memory head = string.concat(
            '{"name":"DecarbonAI Carbon Receipt #',
            tokenId.toString(),
            '","description":"Soulbound receipt: metered AI usage settled via x402 and retired as DCO2 on Avalanche Fuji. DCO2 is a testnet mock, not backed by a real tonne.","attributes":[',
            '{"trait_type":"gCO2e","value":',
            (r.mgCO2e / 1000).toString(),
            '},{"trait_type":"lot","value":',
            r.lotId.toString()
        );
        string memory tail = string.concat(
            '},{"trait_type":"agentId","value":',
            r.agentId.toString(),
            '},{"trait_type":"calls","value":',
            uint256(r.accrualCount).toString(),
            '},{"trait_type":"beneficiary","value":"',
            r.beneficiary.toHexString(),
            '"},{"trait_type":"methodology","value":"',
            uint256(r.methodologyHash).toHexString(32),
            '"},{"display_type":"date","trait_type":"retiredAt","value":',
            uint256(r.retiredAt).toString(),
            "}]}"
        );
        bytes memory json = bytes(string.concat(head, tail));
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
