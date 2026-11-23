// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {IERC5192} from "./interfaces/IERC5192.sol";

/// @title CarbonReceipt: soulbound retirement receipt (ERC-721 + ERC-5192)
/// @notice One token per retirement. Minted only by the RetirementPool to the agent/payer whose
///         metered usage was retired. Tokens are permanently locked (cannot be transferred or approved).
/// @dev The minter can be set exactly once (to the pool), so the owner cannot later point it at an
///      address that forges receipts.
contract CarbonReceipt is ERC721, Ownable2Step, IERC5192 {
    using Strings for uint256;
    using Strings for address;

    struct Retirement {
        address beneficiary; // payer whose accrued usage was retired
        uint256 agentId; // ERC-8004 agent id, 0 if none
        uint256 lotId; // DCO2 lot burned
        uint256 mgCO2e; // amount burned
        uint256 surcharge; // payment-token units accrued since the previous retirement (0 on follow-on receipts)
        uint64 accrualCount; // metered calls covered since the previous retirement
        uint64 retiredAt;
        bytes32 methodologyHash; // methodology of the last accrual in the batch
        bool backed; // the burned lot is backed by a real off-chain retirement (false = mock)
    }

    address public minter;
    uint256 public nextId = 1;
    mapping(uint256 tokenId => Retirement) private _retirements;

    event MinterSet(address indexed minter);

    error NotMinter();
    error Soulbound();
    error ZeroAddress();
    error MinterAlreadySet();

    constructor(address owner_) ERC721("DecarbonAI Carbon Receipt", "DCRCPT") Ownable(owner_) {}

    /// @notice Set once, at deploy time, to the RetirementPool.
    function setMinter(address minter_) external onlyOwner {
        if (minter_ == address(0)) revert ZeroAddress();
        if (minter != address(0)) revert MinterAlreadySet();
        minter = minter_;
        emit MinterSet(minter_);
    }

    function mint(Retirement calldata r) external returns (uint256 tokenId) {
        if (msg.sender != minter) revert NotMinter();
        tokenId = nextId++;
        Retirement storage t = _retirements[tokenId];
        t.beneficiary = r.beneficiary;
        t.agentId = r.agentId;
        t.lotId = r.lotId;
        t.mgCO2e = r.mgCO2e;
        t.surcharge = r.surcharge;
        t.accrualCount = r.accrualCount;
        t.retiredAt = r.retiredAt;
        t.methodologyHash = r.methodologyHash;
        t.backed = r.backed;
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
        string memory p1 = string.concat(
            '{"name":"DecarbonAI Carbon Receipt #',
            tokenId.toString(),
            '","description":"Soulbound receipt: metered AI usage settled via x402 and retired as DCO2 on Avalanche.',
            r.backed ? "" : " MOCK: the burned DCO2 lot is not backed by a real tonne."
        );
        string memory p2 = string.concat(
            '","attributes":[{"trait_type":"gCO2e","value":',
            (r.mgCO2e / 1000).toString(),
            '},{"trait_type":"lot","value":',
            r.lotId.toString()
        );
        string memory p3 = string.concat(
            '},{"trait_type":"backed","value":"',
            r.backed ? "true" : "false",
            '"},{"trait_type":"agentId","value":',
            r.agentId.toString()
        );
        string memory p4 = string.concat(
            '},{"trait_type":"calls","value":',
            uint256(r.accrualCount).toString(),
            '},{"trait_type":"beneficiary","value":"',
            r.beneficiary.toHexString()
        );
        string memory p5 = string.concat(
            '"},{"trait_type":"methodology","value":"',
            uint256(r.methodologyHash).toHexString(32),
            '"},{"display_type":"date","trait_type":"retiredAt","value":',
            uint256(r.retiredAt).toString(),
            "}]}"
        );
        string memory json = string.concat(p1, p2, p3, p4, p5);
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
