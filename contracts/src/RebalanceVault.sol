// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IOracleAMM {
    function priceE8() external view returns (uint256);
    function swapMonForUsdc(uint256 minOut) external payable returns (uint256);
    function swapUsdcForMon(uint256 usdcIn, uint256 minOut) external returns (uint256);
}

interface ILogBook {
    function record(
        uint256 priceE8,
        uint256 bpsBefore,
        uint256 bpsAfter,
        uint256 navBefore,
        uint256 navAfter
    ) external;
}

// Non-custodial vault. Holds native MON + USDC. Shares are issued against NAV
// (denominated in USDC, 6 dec). The agent has exactly one power: trigger
// rebalance() if outside the 60/40 ±5% band. Deposit/withdraw belong to the
// user wallet only. The vault writes its OWN NAV/bps to LogBook in the same
// rebalance tx — agent can't fake that record.
contract RebalanceVault {
    IERC20      public immutable usdc;
    IOracleAMM  public immutable amm;
    ILogBook    public immutable logBook;

    address public owner;
    address public agent;
    bool    public paused;

    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;

    uint256 public constant BPS_TARGET = 6000; // 60% MON
    uint256 public constant BPS_BAND   = 500;  // ±5%

    event Deposited(address indexed user, uint256 monIn, uint256 usdcIn, uint256 shares);
    event Withdrawn(address indexed user, uint256 monOut, uint256 usdcOut, uint256 shares);
    event Rebalanced(uint256 priceE8, uint256 monValueBps);
    event PausedSet(bool paused);

    modifier onlyOwner() { require(msg.sender == owner, "vault: not owner"); _; }
    modifier onlyAgent() { require(msg.sender == agent, "vault: not agent"); _; }

    constructor(IERC20 _usdc, IOracleAMM _amm, address _agent, ILogBook _logBook) {
        owner   = msg.sender;
        agent   = _agent;
        usdc    = _usdc;
        amm     = _amm;
        logBook = _logBook;
    }

    // ---------- views ----------

    function monBalance()   external view returns (uint256) { return address(this).balance; }
    function usdcBalance()  external view returns (uint256) { return usdc.balanceOf(address(this)); }

    function nav() public view returns (uint256) {
        uint256 p = amm.priceE8();
        if (p == 0) return usdc.balanceOf(address(this));
        // 18+8-20 = 6 dec → USDC terms
        return address(this).balance * p / 1e20 + usdc.balanceOf(address(this));
    }

    // ---------- user actions ----------

    // HARD INVARIANT: the agent EOA can never deposit or withdraw.
    function deposit(uint256 usdcAmount) external payable {
        require(msg.sender != agent, "vault: agent blocked");
        require(msg.value > 0 || usdcAmount > 0, "vault: zero deposit");

        uint256 p = amm.priceE8();
        require(p > 0, "vault: price unset");

        // NAV before this deposit (msg.value is already in balance — subtract it;
        // USDC balance is read BEFORE we pull from caller).
        uint256 monBefore  = address(this).balance - msg.value;
        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 navBefore  = monBefore * p / 1e20 + usdcBefore;

        if (usdcAmount > 0) {
            require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "vault: usdc pull");
        }

        // Deposit NAV in USDC terms (6 dec). msg.value contribution priced at current p.
        uint256 depositNAV = msg.value * p / 1e20 + usdcAmount;
        require(depositNAV > 0, "vault: zero nav");

        uint256 shares;
        if (totalShares == 0 || navBefore == 0) {
            shares = depositNAV;
        } else {
            shares = depositNAV * totalShares / navBefore;
        }
        require(shares > 0, "vault: zero shares");

        totalShares      += shares;
        balanceOf[msg.sender] += shares;

        emit Deposited(msg.sender, msg.value, usdcAmount, shares);
    }

    // Pro-rata withdraw of native MON + USDC. Works even when paused.
    function withdraw(uint256 shares) external {
        require(msg.sender != agent, "vault: agent blocked");
        require(shares > 0, "vault: zero shares");
        uint256 bal = balanceOf[msg.sender];
        require(shares <= bal, "vault: insufficient shares");

        uint256 monOut  = address(this).balance * shares / totalShares;
        uint256 usdcOut = usdc.balanceOf(address(this)) * shares / totalShares;

        // Effects before interactions.
        balanceOf[msg.sender] = bal - shares;
        totalShares          -= shares;

        if (usdcOut > 0) {
            require(usdc.transfer(msg.sender, usdcOut), "vault: usdc xfer");
        }
        if (monOut > 0) {
            (bool ok, ) = msg.sender.call{value: monOut}("");
            require(ok, "vault: mon xfer");
        }

        emit Withdrawn(msg.sender, monOut, usdcOut, shares);
    }

    // ---------- agent action ----------

    function rebalance() external onlyAgent {
        require(!paused, "vault: paused");
        uint256 p = amm.priceE8();
        require(p > 0, "vault: price unset");

        // Pre-snapshot.
        uint256 monValBefore  = address(this).balance * p / 1e20; // 6 dec
        uint256 usdcBalBefore = usdc.balanceOf(address(this));
        uint256 navBefore     = monValBefore + usdcBalBefore;
        require(navBefore > 0, "vault: empty");
        uint256 bpsBefore = monValBefore * 10_000 / navBefore;

        uint256 target = navBefore * BPS_TARGET / 10_000; // USDC-terms target for MON value
        uint256 band   = navBefore * BPS_BAND   / 10_000;

        if (monValBefore > target && monValBefore - target > band) {
            // Trim MON → USDC. Δ_usdc (6 dec) of MON value to sell.
            uint256 deltaUsdc = monValBefore - target;
            uint256 deltaMonWei = deltaUsdc * 1e20 / p; // 6+20-8 = 18 dec
            if (deltaMonWei > address(this).balance) {
                deltaMonWei = address(this).balance;
            }
            amm.swapMonForUsdc{value: deltaMonWei}(0);
        } else if (target > monValBefore && target - monValBefore > band) {
            // Buy MON with USDC.
            uint256 deltaUsdc = target - monValBefore;
            if (deltaUsdc > usdc.balanceOf(address(this))) {
                deltaUsdc = usdc.balanceOf(address(this));
            }
            if (deltaUsdc > 0) {
                require(usdc.approve(address(amm), deltaUsdc), "vault: approve");
                amm.swapUsdcForMon(deltaUsdc, 0);
            }
        }
        // else: inside band → no-op (still log).

        // Post-snapshot — at the SAME priceE8 used pre-swap, so bps/NAV are
        // comparable. Real fees show up as small NAV slippage in navAfter.
        uint256 monValAfter  = address(this).balance * p / 1e20;
        uint256 usdcBalAfter = usdc.balanceOf(address(this));
        uint256 navAfter     = monValAfter + usdcBalAfter;
        uint256 bpsAfter     = navAfter == 0 ? 0 : monValAfter * 10_000 / navAfter;

        // Vault-signed proof in the SAME tx.
        logBook.record(p, bpsBefore, bpsAfter, navBefore, navAfter);
        emit Rebalanced(p, bpsAfter);
    }

    // ---------- owner kill switch ----------

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    receive() external payable {
        // Allow native MON to land (e.g. from AMM swap-in). Caller != agent stays
        // enforced for deposit/withdraw; bare receives are needed because the AMM
        // sends MON back to us in swapUsdcForMon.
    }
}
