// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {OracleAMM} from "../src/OracleAMM.sol";
import {LogBook} from "../src/LogBook.sol";
import {RebalanceVault, IOracleAMM, ILogBook} from "../src/RebalanceVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address agent      = vm.envAddress("AGENT_ADDR");
        address demoUser   = vm.envAddress("DEMO_USER");
        address deployer   = vm.addr(deployerPk);

        require(deployer != agent, "Deploy: deployer == agent, must be different keys");

        vm.startBroadcast(deployerPk);

        MockUSDC usdc       = new MockUSDC();
        OracleAMM amm       = new OracleAMM(deployer, agent, IERC20(address(usdc)));
        LogBook   logBook   = new LogBook(deployer);
        RebalanceVault vault = new RebalanceVault(
            IERC20(address(usdc)),
            IOracleAMM(address(amm)),
            agent,
            ILogBook(address(logBook))
        );
        logBook.setVault(address(vault));

        // Initial price: 1 MON = $2 (8 dec) — Phase 1 default; Phase 5 swaps to Pyth feed.
        amm.setPrice(2e8);

        // Seed AMM: 120 MON (depth headroom for first rebalance) + 1,000,000 USDC.
        amm.seed{value: 120 ether}();
        usdc.mint(deployer, 1_000_000e6);
        usdc.approve(address(amm), 1_000_000e6);
        amm.seedUsdc(1_000_000e6);

        // Demo user starts with 1,000 USDC so they can deposit MON+USDC immediately.
        usdc.mint(demoUser, 1_000e6);

        vm.stopBroadcast();

        console2.log("===== Chog Vault deploy =====");
        console2.log("deployer    :", deployer);
        console2.log("agent       :", agent);
        console2.log("demoUser    :", demoUser);
        console2.log("MockUSDC    :", address(usdc));
        console2.log("OracleAMM   :", address(amm));
        console2.log("LogBook     :", address(logBook));
        console2.log("RebalanceVault:", address(vault));
        console2.log("deployBlock :", block.number);

        // addresses.json blob — copy into config/addresses.json
        console2.log("");
        console2.log("---- addresses.json ----");
        console2.log("{");
        console2.log('  "chainId": 10143,');
        console2.log('  "rpc": "https://testnet-rpc.monad.xyz",');
        console2.log('  "rpcFallback": "https://10143.rpc.thirdweb.com",');
        console2.log('  "explorerBase": "https://testnet.monadscan.com",');
        console2.log(string.concat('  "MockUSDC": "',       vm.toString(address(usdc)),    '",'));
        console2.log(string.concat('  "OracleAMM": "',      vm.toString(address(amm)),     '",'));
        console2.log(string.concat('  "LogBook": "',        vm.toString(address(logBook)), '",'));
        console2.log(string.concat('  "RebalanceVault": "', vm.toString(address(vault)),   '",'));
        console2.log(string.concat('  "agent": "',          vm.toString(agent),            '",'));
        console2.log(string.concat('  "demoUser": "',       vm.toString(demoUser),         '",'));
        console2.log(string.concat('  "deployer": "',       vm.toString(deployer),         '",'));
        console2.log(string.concat('  "deployBlock": ',     vm.toString(block.number),     ','));
        console2.log('  "pythHermesBeta": "https://hermes-beta.pyth.network",');
        console2.log('  "monUsdFeedId": "0xe786153cc54abd4b0e53b4c246d54d9f8eb3f3b5a34d4fc5a2e9a423b0ba5d6b"');
        console2.log("}");
    }
}
