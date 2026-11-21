// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Json} from "./lib/Json.sol";

/// @title DCO2: DecarbonAI carbon credit token on Avalanche (custodial bridge v0)
/// @notice One ERC-1155 id per credit lot. Amounts are in milligrams of CO2e: 1 kg = 1e6, 1 t = 1e9.
///         Each deployment is either BACKED or MOCK, fixed at construction:
///         - BACKED (mainnet): the owner retires real credits off-chain (e.g. Carbonmark on Base)
///           and mints exactly that quantity here, 1:1, recording registry, project, serial,
///           vintage, the public certificate URL and the source retirement tx. Each serial and each
///           retirement tx can back only one lot. Holders trust the owner (custodian) for this.
///         - MOCK (testnet): demo inventory, NOT backed by any real tonne. Lots are flagged
///           unbacked, so the pool never writes "carbon-settled" reputation for them.
contract DCO2 is ERC1155, Ownable2Step {
    using Strings for uint256;

    uint256 public constant MG_PER_KG = 1e6;

    struct Lot {
        string registry; // e.g. "Universal Carbon Registry", "Verra VCS", "TGO T-VER"
        string projectId; // e.g. "UCR-419"
        string projectName;
        string serial; // registry serial / credit id of the retired credits
        uint16 vintage; // year
        string certificateURI; // public retirement certificate (e.g. Carbonmark)
        string retirementTx; // source retirement tx, e.g. "eip155:8453:0x6693..."
        uint256 quantityKg; // kg CO2e retired off-chain = minted / 1e6
        bool backed; // set by the contract: true only on a BACKED deployment
        uint64 mintedAt;
    }

    string public name;
    string public symbol;
    /// @notice True if lots are backed 1:1 by real off-chain retirements; false for a mock deployment.
    bool public immutable backedToken;

    uint256 public nextLotId = 1;
    mapping(uint256 lotId => Lot) private _lots;
    mapping(uint256 lotId => uint256) public totalSupply;
    mapping(bytes32 serialHash => bool) public serialUsed;
    mapping(bytes32 retirementHash => bool) public retirementUsed;

    event LotMinted(uint256 indexed lotId, address indexed to, string serial, uint256 quantityKg, bool backed);
    event Retired(uint256 indexed lotId, address indexed from, uint256 mgCO2e);

    error EmptyField();
    error ZeroQuantity();
    error SerialAlreadyMinted();
    error RetirementAlreadyUsed();
    error UnknownLot();

    constructor(address owner_, string memory name_, string memory symbol_, bool backed_) ERC1155("") Ownable(owner_) {
        name = name_;
        symbol = symbol_;
        backedToken = backed_;
    }

    /// @notice Mint a lot 1:1 against `data.quantityKg` kg retired off-chain (BACKED) or as mock inventory.
    /// @dev `data.backed` and `data.mintedAt` are ignored and set by the contract.
    function mintLot(address to, Lot calldata data) external onlyOwner returns (uint256 lotId) {
        if (data.quantityKg == 0) revert ZeroQuantity();
        if (bytes(data.registry).length == 0 || bytes(data.serial).length == 0) revert EmptyField();
        if (backedToken && (bytes(data.certificateURI).length == 0 || bytes(data.retirementTx).length == 0)) {
            revert EmptyField();
        }
        bytes32 serialHash = keccak256(abi.encode(data.registry, data.serial));
        if (serialUsed[serialHash]) revert SerialAlreadyMinted();
        serialUsed[serialHash] = true;
        if (bytes(data.retirementTx).length != 0) {
            bytes32 retirementHash = keccak256(bytes(data.retirementTx));
            if (retirementUsed[retirementHash]) revert RetirementAlreadyUsed();
            retirementUsed[retirementHash] = true;
        }

        lotId = nextLotId++;
        Lot storage l = _lots[lotId];
        l.registry = data.registry;
        l.projectId = data.projectId;
        l.projectName = data.projectName;
        l.serial = data.serial;
        l.vintage = data.vintage;
        l.certificateURI = data.certificateURI;
        l.retirementTx = data.retirementTx;
        l.quantityKg = data.quantityKg;
        l.backed = backedToken;
        l.mintedAt = uint64(block.timestamp);

        uint256 amount = data.quantityKg * MG_PER_KG;
        totalSupply[lotId] += amount;
        _mint(to, lotId, amount, "");
        emit LotMinted(lotId, to, data.serial, data.quantityKg, backedToken);
    }

    /// @notice Burn `mgCO2e` of lot `lotId` held by `from` (the holder or an approved operator).
    function retire(address from, uint256 lotId, uint256 mgCO2e) external {
        if (from != msg.sender && !isApprovedForAll(from, msg.sender)) {
            revert ERC1155MissingApprovalForAll(msg.sender, from);
        }
        totalSupply[lotId] -= mgCO2e;
        _burn(from, lotId, mgCO2e);
        emit Retired(lotId, from, mgCO2e);
    }

    function lot(uint256 lotId) external view returns (Lot memory) {
        // mintedAt == 0 is the "lot does not exist" flag, not a time comparison
        // slither-disable-next-line incorrect-equality,timestamp
        if (_lots[lotId].mintedAt == 0) revert UnknownLot();
        return _lots[lotId];
    }

    /// @notice True only for lots minted against a real off-chain retirement.
    function isBacked(uint256 lotId) external view returns (bool) {
        return _lots[lotId].backed;
    }

    function uri(uint256 lotId) public view override returns (string memory) {
        Lot storage l = _lots[lotId];
        if (l.mintedAt == 0) revert UnknownLot();
        string memory description = l.backed
            ? "Custodial bridge v0: 1 unit = 1 mgCO2e, minted 1:1 against credits retired off-chain (see certificate and retirementTx)."
            : "MOCK credit, NOT backed by a real tonne. 1 unit = 1 mgCO2e. Testnet demo inventory.";
        string memory p1 = string.concat(
            '{"name":"DCO2 lot #', lotId.toString(), '","description":"', description, '","properties":{"backed":'
        );
        string memory p2 = string.concat(
            l.backed ? "true" : "false",
            ',"registry":"',
            Json.escape(l.registry),
            '","projectId":"',
            Json.escape(l.projectId)
        );
        string memory p3 = string.concat(
            '","project":"', Json.escape(l.projectName), '","serial":"', Json.escape(l.serial), '","vintage":'
        );
        string memory p4 =
            string.concat(uint256(l.vintage).toString(), ',"quantityKg":', l.quantityKg.toString(), ',"certificate":"');
        string memory p5 =
            string.concat(Json.escape(l.certificateURI), '","retirementTx":"', Json.escape(l.retirementTx), '"}}');
        string memory json = string.concat(p1, p2, p3, p4, p5);
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
