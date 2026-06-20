// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {OracleAMM} from "../src/OracleAMM.sol";
import {LogBook} from "../src/LogBook.sol";
import {RebalanceVault, IOracleAMM, ILogBook} from "../src/RebalanceVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract VaultTest is Test {
    MockUSDC       usdc;
    OracleAMM      amm;
    LogBook        logBook;
    RebalanceVault vault;

    address deployer = address(this);
    address agent    = address(0xA6E47); // distinct EOA, not a precompile
    address alice    = address(0xA11A);
    address bob      = address(0xB0BB);

    uint256 constant PRICE_E8 = 2e8;          // 1 MON = $2
    uint256 constant AMM_MON_SEED  = 120 ether;
    uint256 constant AMM_USDC_SEED = 1_000_000e6;

    // Used to dodge stack-too-deep in the value-conservation test.
    struct ConsState {
        uint256 aliceMonIn;
        uint256 aliceUsdcIn;
        uint256 bobMonIn;
        uint256 bobUsdcIn;
        uint256 navAfterAlice;
        uint256 navAfterBob;
    }

    function setUp() public {
        usdc    = new MockUSDC();
        amm     = new OracleAMM(deployer, agent, IERC20(address(usdc)));
        logBook = new LogBook(deployer);
        vault   = new RebalanceVault(IERC20(address(usdc)), IOracleAMM(address(amm)), agent, ILogBook(address(logBook)));
        logBook.setVault(address(vault));

        amm.setPrice(PRICE_E8);

        // Seed the AMM with deep liquidity (mirror deploy script).
        vm.deal(deployer, AMM_MON_SEED + 100 ether);
        amm.seed{value: AMM_MON_SEED}();
        usdc.mint(deployer, AMM_USDC_SEED);
        usdc.approve(address(amm), AMM_USDC_SEED);
        amm.seedUsdc(AMM_USDC_SEED);

        // Fund the users.
        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
        usdc.mint(alice, 10_000e6);
        usdc.mint(bob,   10_000e6);
    }

    // --- 1. Swap math ---
    function test_SwapMath_OneMonGives1p994Usdc() public {
        // gross = 1e18 * 2e8 / 1e20 = 2e6 (= 2.0 USDC); fee 0.3% = 6000; out = 1_994_000
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 out = amm.swapMonForUsdc{value: 1 ether}(0);
        assertEq(out, 1_994_000, "1 MON -> 1.994 USDC");
        assertEq(usdc.balanceOf(alice), 10_000e6 + 1_994_000);

        // Reverse: 2 USDC -> ~0.997 MON
        vm.startPrank(alice);
        usdc.approve(address(amm), 2e6);
        uint256 monOut = amm.swapUsdcForMon(2e6, 0);
        vm.stopPrank();
        // gross = 2e6 * 1e20 / 2e8 = 1e18; fee = 3e15; out = 997e15
        assertEq(monOut, 997e15, "2 USDC -> 0.997 MON");
    }

    // --- 2. Deposit/withdraw round trip ---
    function test_DepositWithdrawRoundTrip() public {
        uint256 monIn  = 60 ether;
        uint256 usdcIn = 40e6;

        vm.startPrank(alice);
        usdc.approve(address(vault), usdcIn);
        vault.deposit{value: monIn}(usdcIn);
        uint256 shares = vault.balanceOf(alice);
        vault.withdraw(shares);
        vm.stopPrank();

        // No rebalance happened, single-LP, so balances should be (essentially) restored.
        // Single-depositor accounting is exact: no rounding loss for a sole LP.
        assertEq(alice.balance,         100 ether,  "MON restored");
        assertEq(usdc.balanceOf(alice), 10_000e6,   "USDC restored");
        assertEq(vault.totalShares(),   0,          "shares cleared");
    }

    // --- 3. Non-agent cannot rebalance ---
    function test_NonAgentCannotRebalance() public {
        // Seed the vault so rebalance has NAV to work with.
        vm.startPrank(alice);
        usdc.approve(address(vault), 40e6);
        vault.deposit{value: 60 ether}(40e6);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(bytes("vault: not agent"));
        vault.rebalance();

        vm.prank(deployer);
        vm.expectRevert(bytes("vault: not agent"));
        vault.rebalance();
    }

    // --- 4. Agent cannot deposit or withdraw ---
    function test_AgentCannotDepositOrWithdraw() public {
        vm.deal(agent, 5 ether);
        usdc.mint(agent, 100e6);

        vm.startPrank(agent);
        usdc.approve(address(vault), 100e6);
        vm.expectRevert(bytes("vault: agent blocked"));
        vault.deposit{value: 1 ether}(10e6);

        vm.expectRevert(bytes("vault: agent blocked"));
        vault.withdraw(1);
        vm.stopPrank();
    }

    // --- 5. Paused blocks rebalance but allows withdraw ---
    function test_PausedBlocksRebalance_AllowsWithdraw() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 40e6);
        vault.deposit{value: 60 ether}(40e6);
        vm.stopPrank();

        vault.setPaused(true);
        assertTrue(vault.paused());

        vm.prank(agent);
        vm.expectRevert(bytes("vault: paused"));
        vault.rebalance();

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(shares); // still works
        assertEq(vault.balanceOf(alice), 0);
    }

    // --- 6. Value conservation across multiple depositors ---
    function test_ValueConservation_MultiDeposit() public {
        ConsState memory s;

        s.aliceMonIn  = 60 ether;
        s.aliceUsdcIn = 40e6;
        s.bobMonIn    = 30 ether;
        s.bobUsdcIn   = 20e6;

        vm.startPrank(alice);
        usdc.approve(address(vault), s.aliceUsdcIn);
        vault.deposit{value: s.aliceMonIn}(s.aliceUsdcIn);
        vm.stopPrank();
        s.navAfterAlice = vault.nav();

        vm.startPrank(bob);
        usdc.approve(address(vault), s.bobUsdcIn);
        vault.deposit{value: s.bobMonIn}(s.bobUsdcIn);
        vm.stopPrank();
        s.navAfterBob = vault.nav();

        // Alice deposit NAV (USDC terms): 60 MON @ $2 = 120 USDC + 40 USDC = 160e6
        assertEq(s.navAfterAlice, 160e6, "alice NAV");
        // Bob adds: 30 MON @ $2 = 60 + 20 = 80e6 → total 240e6
        assertEq(s.navAfterBob,   240e6, "alice+bob NAV");

        // Shares: alice was first → 160e6 shares. Bob got 80*160/160 = 80e6.
        assertEq(vault.balanceOf(alice), 160e6, "alice shares");
        assertEq(vault.balanceOf(bob),    80e6, "bob shares");
        assertEq(vault.totalShares(),    240e6, "total shares");
    }

    // --- 7. Pro-rata withdraw after rebalance ---
    function test_WithdrawProRata_AfterRebalance() public {
        // Setup: deposit 60 MON + 40 USDC (NAV = 160 USDC, already at 75/25, well outside band).
        // band = 160 * 500 / 10000 = 8 USDC; target MON value = 96. monValBefore = 120. Δ = 24 > 8 → trims MON.
        vm.startPrank(alice);
        usdc.approve(address(vault), 40e6);
        vault.deposit{value: 60 ether}(40e6);
        vm.stopPrank();

        uint256 sharesBefore = vault.balanceOf(alice);
        assertEq(sharesBefore, 160e6);

        vm.prank(agent);
        vault.rebalance();

        // After rebalance some MON has been swapped to USDC. Shares unchanged.
        assertEq(vault.balanceOf(alice), sharesBefore);

        // Withdraw all → user gets all underlying (now post-rebalance mix).
        uint256 monBalBefore  = alice.balance;
        uint256 usdcBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        vault.withdraw(sharesBefore);

        // Sole LP → withdraws the entire vault balance.
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.totalShares(),     0);
        // She received SOMETHING of each leg.
        assertGt(alice.balance,         monBalBefore,  "got MON");
        assertGt(usdc.balanceOf(alice), usdcBalBefore, "got USDC");
        // Vault drained.
        assertEq(address(vault).balance,           0, "vault MON drained");
        assertEq(usdc.balanceOf(address(vault)),   0, "vault USDC drained");
    }

    // --- 8. LogBook gets one entry per rebalance with correct nav before/after, count() advances ---
    function test_LogBook_OneEntryPerRebalance_WithCorrectNav() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 40e6);
        vault.deposit{value: 60 ether}(40e6); // NAV = 160e6 (USDC terms)
        vm.stopPrank();

        assertEq(logBook.count(), 0);

        vm.prank(agent);
        vault.rebalance();

        assertEq(logBook.count(), 1, "one entry per rebalance");

        (uint256 priceE8, uint256 bpsBefore, uint256 bpsAfter, uint256 navBefore, uint256 navAfter, uint256 ts)
            = logBook.entries(0);

        assertEq(priceE8,    PRICE_E8,   "price recorded");
        assertEq(navBefore,  160e6,      "navBefore matches pre-rebalance NAV");
        assertEq(bpsBefore,  7500,       "bpsBefore = 120/160 = 75%");
        // After trimming MON → USDC at a 0.3% fee, NAV drops slightly but stays close to navBefore.
        assertLe(navAfter,   navBefore,  "navAfter <= navBefore (fee paid)");
        assertGe(navAfter,   navBefore * 99 / 100, "navAfter within 1% of navBefore");
        // bpsAfter should be much closer to target 6000.
        assertLt(bpsAfter,   bpsBefore,  "bpsAfter < bpsBefore (trimmed MON)");
        assertApproxEqAbs(bpsAfter, 6000, 100, "bpsAfter ~ 60% target");
        assertGt(ts, 0,                   "ts set");
    }

    // --- 9. Only the vault can call LogBook.record() ---
    function test_LogBook_OnlyVaultCanRecord() public {
        vm.prank(alice);
        vm.expectRevert(bytes("log: not vault"));
        logBook.record(PRICE_E8, 7500, 6000, 160e6, 159e6);

        vm.prank(agent);
        vm.expectRevert(bytes("log: not vault"));
        logBook.record(PRICE_E8, 7500, 6000, 160e6, 159e6);

        vm.prank(deployer);
        vm.expectRevert(bytes("log: not vault"));
        logBook.record(PRICE_E8, 7500, 6000, 160e6, 159e6);
    }

    receive() external payable {}
}
