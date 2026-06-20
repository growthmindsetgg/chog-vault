// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Toy oracle-priced AMM. MON is native (18 dec), USDC is ERC20 (6 dec),
// price is priceE8 (USD-per-MON, 8 dec). Math always normalizes through 1e20:
//   monValueInUsdc  = monWei  * priceE8 / 1e20   (18 + 8 - 20 = 6 dec)
//   monWeiFromUsdc  = usdc6   * 1e20    / priceE8 (6  + 20 - 8 = 18 dec)
// Sanity: 1 MON @ priceE8=2e8 -> gross=2e6 (2.0 USDC), fee=6_000 (0.006), out=1_994_000 (1.994 USDC).
contract OracleAMM {
    address public owner;
    address public agent;
    uint256 public priceE8;
    uint256 public constant FEE_BPS = 30;

    IERC20 public immutable usdc;

    event PriceSet(uint256 priceE8);
    event SwapMonForUsdc(address indexed caller, uint256 monIn, uint256 usdcOut);
    event SwapUsdcForMon(address indexed caller, uint256 usdcIn, uint256 monOut);

    constructor(address _owner, address _agent, IERC20 _usdc) {
        owner = _owner;
        agent = _agent;
        usdc = _usdc;
    }

    function setPrice(uint256 _priceE8) external {
        require(msg.sender == owner || msg.sender == agent, "amm: not authorized");
        require(_priceE8 > 0, "amm: zero price");
        priceE8 = _priceE8;
        emit PriceSet(_priceE8);
    }

    // Pay native MON, receive USDC.
    function swapMonForUsdc(uint256 minOut) external payable returns (uint256 out) {
        require(priceE8 > 0, "amm: price unset");
        require(msg.value > 0, "amm: zero in");
        uint256 gross = msg.value * priceE8 / 1e20; // 18+8-20 = 6 dec
        uint256 fee = gross * FEE_BPS / 10_000;
        out = gross - fee;
        require(out >= minOut, "amm: slippage");
        require(usdc.transfer(msg.sender, out), "amm: usdc xfer fail");
        emit SwapMonForUsdc(msg.sender, msg.value, out);
    }

    // Pay USDC, receive native MON.
    function swapUsdcForMon(uint256 usdcIn, uint256 minOut) external returns (uint256 out) {
        require(priceE8 > 0, "amm: price unset");
        require(usdcIn > 0, "amm: zero in");
        require(usdc.transferFrom(msg.sender, address(this), usdcIn), "amm: usdc pull fail");
        uint256 gross = usdcIn * 1e20 / priceE8; // 6+20-8 = 18 dec (wei)
        uint256 fee = gross * FEE_BPS / 10_000;
        out = gross - fee;
        require(out >= minOut, "amm: slippage");
        require(address(this).balance >= out, "amm: mon depth");
        (bool ok, ) = msg.sender.call{value: out}("");
        require(ok, "amm: mon xfer fail");
        emit SwapUsdcForMon(msg.sender, usdcIn, out);
    }

    // Owner seeds liquidity.
    function seed() external payable {
        require(msg.sender == owner, "amm: not owner");
    }

    function seedUsdc(uint256 amount) external {
        require(msg.sender == owner, "amm: not owner");
        require(usdc.transferFrom(msg.sender, address(this), amount), "amm: usdc pull fail");
    }

    receive() external payable {}
}
