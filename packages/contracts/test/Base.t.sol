// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DCO2} from "../src/DCO2.sol";
import {CarbonReceipt} from "../src/CarbonReceipt.sol";
import {RetirementPool} from "../src/RetirementPool.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {ERC8004ReputationAdapter} from "../src/ERC8004ReputationAdapter.sol";
import {IERC8004Reputation, IERC8004Identity} from "../src/interfaces/IERC8004Reputation.sol";
import {MockReputationRegistry} from "./mocks/MockReputationRegistry.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

abstract contract BaseTest is Test {
    uint256 internal constant KG = 1e6; // mg
    uint256 internal constant PRICE = 25e6; // $25 / tonne in 6-decimal units
    uint256 internal constant MIN_PRICE = 1e6; // $1 / tonne floor
    bytes32 internal constant METHOD = keccak256("v0-2026-08-anchored");
    uint256 internal constant AGENT_ID = 42;

    address internal admin = makeAddr("admin");
    address internal meter = makeAddr("meter");
    address internal payTo = makeAddr("payTo");
    address internal agent = makeAddr("agent");

    TestUSDC internal usdc;
    DCO2 internal dco2; // BACKED deployment (real lots) unless a test deploys a mock one
    CarbonReceipt internal receipt;
    RetirementPool internal pool;
    MockReputationRegistry internal registry;
    MockIdentityRegistry internal identity;
    ERC8004ReputationAdapter internal adapter;

    function setUp() public virtual {
        usdc = new TestUSDC();
        dco2 = new DCO2(admin, "DecarbonAI Carbon Tonne (custodial v0)", "DCO2", true);
        receipt = new CarbonReceipt(admin);
        identity = new MockIdentityRegistry();
        identity.set(AGENT_ID, agent, address(0));
        pool = new RetirementPool(_config(dco2, receipt));
        registry = new MockReputationRegistry();
        registry.setOwner(AGENT_ID, agent);
        adapter = new ERC8004ReputationAdapter(admin, IERC8004Reputation(address(registry)), "dcrcpt:");

        vm.startPrank(admin);
        receipt.setMinter(address(pool));
        adapter.setPool(address(pool));
        pool.setReputation(adapter);
        pool.grantRole(pool.METER_ROLE(), meter);
        pool.setSurchargeFunder(meter, payTo);
        pool.setMethodology(METHOD, "v0-2026-08-anchored", true);
        _mintLot("SERIAL-1", 1000);
        vm.stopPrank();

        usdc.mint(payTo, 1_000e6);
        vm.prank(payTo);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _config(DCO2 d, CarbonReceipt r) internal view returns (RetirementPool.Config memory) {
        return RetirementPool.Config({
            admin: admin,
            adminDelay: 0,
            paymentToken: IERC20(address(usdc)),
            dco2: d,
            receipt: r,
            identityRegistry: IERC8004Identity(address(identity)),
            thresholdMg: KG,
            minPricePerTonne: MIN_PRICE,
            pricePerTonne: PRICE,
            maxMgPerAccrual: 1_000 * KG,
            maxMgPerDay: 1_000_000 * KG,
            maxRetirementsPerCall: 5
        });
    }

    function _lot(string memory serial, uint256 kg) internal pure returns (DCO2.Lot memory) {
        return DCO2.Lot({
            registry: "Universal Carbon Registry",
            projectId: "UCR-419",
            projectName: "30 MW Solar Power Project TKSPL",
            serial: serial,
            vintage: 2023,
            certificateURI: string.concat("https://app.carbonmark.com/retirements/id/", serial),
            retirementTx: string.concat("eip155:8453:", serial),
            quantityKg: kg,
            backed: false,
            mintedAt: 0
        });
    }

    /// @dev caller must be pranking as admin
    function _mintLot(string memory serial, uint256 kg) internal returns (uint256 lotId) {
        lotId = dco2.mintLot(address(pool), _lot(serial, kg));
        pool.addLot(lotId);
    }

    function _accrue(bytes32 id, address payer, uint256 agentId, uint256 mg) internal {
        uint256 s = pool.quote(mg);
        vm.prank(meter);
        pool.accrue(id, payer, agentId, mg, s, METHOD);
    }

    function _item(bytes32 id, address payer, uint256 agentId, uint256 mg)
        internal
        view
        returns (RetirementPool.Accrual memory)
    {
        return RetirementPool.Accrual(id, payer, agentId, mg, pool.quote(mg), METHOD);
    }
}
