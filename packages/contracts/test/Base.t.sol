// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DCO2} from "../src/DCO2.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {ERC8004ReputationAdapter} from "../src/ERC8004ReputationAdapter.sol";
import {IERC8004Reputation} from "../src/interfaces/IERC8004Reputation.sol";
import {MockReputationRegistry} from "./mocks/MockReputationRegistry.sol";

abstract contract BaseTest is Test {
    uint256 internal constant KG = 1e6; // mg
    uint256 internal constant PRICE = 25e6; // $25 / tonne in 6-decimal units
    bytes32 internal constant METHOD = keccak256("v0-2026-08-anchored");
    uint256 internal constant AGENT_ID = 42;

    address internal admin = makeAddr("admin");
    address internal meter = makeAddr("meter");
    address internal agent = makeAddr("agent");
    address internal agentOwner = makeAddr("agentOwner");

    TestUSDC internal usdc;
    DCO2 internal dco2;
    CarbonReceipt internal receipt;
    RetirementPool internal pool;
    MockReputationRegistry internal registry;
    ERC8004ReputationAdapter internal adapter;

    function setUp() public virtual {
        usdc = new TestUSDC();
        dco2 = new DCO2(admin);
        receipt = new CarbonReceipt(admin);
        pool = new RetirementPool(
            RetirementPool.Config({
                admin: admin,
                paymentToken: IERC20(address(usdc)),
                dco2: dco2,
                receipt: receipt,
                thresholdMg: KG,
                pricePerTonne: PRICE,
                maxMgPerAccrual: 1_000 * KG,
                maxRetirementsPerCall: 5
            })
        );
        registry = new MockReputationRegistry();
        registry.setOwner(AGENT_ID, agentOwner);
        adapter = new ERC8004ReputationAdapter(admin, IERC8004Reputation(address(registry)), "dcrcpt:");

        vm.startPrank(admin);
        receipt.setMinter(address(pool));
        adapter.setPool(address(pool));
        pool.setReputation(adapter);
        pool.grantRole(pool.METER_ROLE(), meter);
        pool.setMethodology(METHOD, "v0-2026-08-anchored", true);
        _mintLot("SERIAL-1", 1);
        vm.stopPrank();

        usdc.mint(meter, 1_000e6);
        vm.prank(meter);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _lot(string memory serial, uint256 tonnes) internal pure returns (DCO2.Lot memory) {
        return DCO2.Lot({
            registry: "TGO T-VER",
            serial: serial,
            projectName: "Mae Fah Luang forest",
            vintage: 2024,
            retirementProofURI: "https://www.carbonmark.com/retirements/0xabc",
            tonnes: tonnes,
            mintedAt: 0
        });
    }

    /// @dev caller must be pranking as admin
    function _mintLot(string memory serial, uint256 tonnes) internal returns (uint256 lotId) {
        lotId = dco2.mintLot(address(pool), _lot(serial, tonnes));
        pool.addLot(lotId);
    }

    function _accrue(bytes32 id, address payer, uint256 agentId, uint256 mg) internal {
        uint256 s = pool.quote(mg);
        vm.prank(meter);
        pool.accrue(id, payer, agentId, mg, s, METHOD);
    }
}
