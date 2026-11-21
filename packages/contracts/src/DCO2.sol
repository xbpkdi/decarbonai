// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title DCO2: DecarbonAI carbon credit token on Avalanche Fuji (TESTNET MOCK)
/// @notice TESTNET MOCK. NOT BACKED BY A REAL TONNE. Lots minted by this deployment are demo
///         inventory so the settle -> retire -> receipt path can run end to end on Fuji.
///         One ERC-1155 id per credit lot. Amounts are in milligrams of CO2e: 1 tonne = 1e9 units.
/// @dev Designed as a custodial bridge v0 so a real tonne can be wired in later: the owner would
///      pre-retire real tonnes off-chain (e.g. Carbonmark / Verra / T-VER), record the registry,
///      serial, vintage and public retirement proof in the lot, and mint exactly that many tonnes
///      (1:1). Holders would trust the owner for that; a native registry bridge is roadmap.
contract DCO2 is ERC1155, Ownable {
    using Strings for uint256;

    string public constant name = "DecarbonAI DCO2 (testnet mock, not backed by a real tonne)";
    string public constant symbol = "mockDCO2";

    uint256 public constant MG_PER_TONNE = 1e9;

    struct Lot {
        string registry; // e.g. "Verra VCS", "TGO T-VER"
        string serial; // registry serial number of the pre-retired credit(s)
        string projectName;
        uint16 vintage; // year
        string retirementProofURI; // public URL of the off-chain retirement backing this lot
        uint256 tonnes; // whole tonnes pre-retired off-chain = minted / 1e9
        uint64 mintedAt;
    }

    uint256 public nextLotId = 1;
    mapping(uint256 lotId => Lot) private _lots;
    mapping(uint256 lotId => uint256) public totalSupply;
    mapping(bytes32 serialHash => bool) public serialUsed;

    event LotMinted(
        uint256 indexed lotId,
        address indexed to,
        string registry,
        string serial,
        uint16 vintage,
        uint256 tonnes,
        string retirementProofURI
    );
    event Retired(uint256 indexed lotId, address indexed from, uint256 mgCO2e);

    error EmptyField();
    error ZeroTonnes();
    error SerialAlreadyMinted();
    error UnknownLot();

    constructor(address owner_) ERC1155("") Ownable(owner_) {}

    /// @notice Mint a lot 1:1 against `lot.tonnes` real tonnes already retired off-chain.
    /// @dev Each registry serial can back only one lot, so the same tonne cannot be minted twice.
    function mintLot(address to, Lot calldata data) external onlyOwner returns (uint256 lotId) {
        if (data.tonnes == 0) revert ZeroTonnes();
        if (
            bytes(data.registry).length == 0 || bytes(data.serial).length == 0
                || bytes(data.retirementProofURI).length == 0
        ) {
            revert EmptyField();
        }
        bytes32 serialHash = keccak256(abi.encode(data.registry, data.serial));
        if (serialUsed[serialHash]) revert SerialAlreadyMinted();
        serialUsed[serialHash] = true;

        lotId = nextLotId++;
        Lot storage l = _lots[lotId];
        l.registry = data.registry;
        l.serial = data.serial;
        l.projectName = data.projectName;
        l.vintage = data.vintage;
        l.retirementProofURI = data.retirementProofURI;
        l.tonnes = data.tonnes;
        l.mintedAt = uint64(block.timestamp);

        uint256 amount = data.tonnes * MG_PER_TONNE;
        totalSupply[lotId] += amount;
        _mint(to, lotId, amount, "");
        emit LotMinted(lotId, to, data.registry, data.serial, data.vintage, data.tonnes, data.retirementProofURI);
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
        if (_lots[lotId].mintedAt == 0) revert UnknownLot();
        return _lots[lotId];
    }

    function uri(uint256 lotId) public view override returns (string memory) {
        Lot storage l = _lots[lotId];
        if (l.mintedAt == 0) revert UnknownLot();
        string memory head = string.concat(
            '{"name":"DCO2 lot #',
            lotId.toString(),
            '","description":"TESTNET MOCK credit, not backed by a real tonne. 1 unit = 1 mgCO2e. Lot fields mirror a custodial bridge v0 so a real retired tonne can be wired in later.","properties":{"registry":"',
            l.registry,
            '","serial":"',
            l.serial,
            '","project":"',
            l.projectName
        );
        string memory tail = string.concat(
            '","vintage":',
            uint256(l.vintage).toString(),
            ',"tonnes":',
            l.tonnes.toString(),
            ',"retirementProof":"',
            l.retirementProofURI,
            '"}}'
        );
        bytes memory json = bytes(string.concat(head, tail));
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
