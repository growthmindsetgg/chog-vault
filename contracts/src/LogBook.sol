// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// On-chain proof book. Only the vault can append entries — the vault writes
// its own computed NAV/bps before-and-after every rebalance, so the agent
// can't fake the record by pushing forged numbers from off-chain.
contract LogBook {
    struct Entry {
        uint256 priceE8;
        uint256 bpsBefore;
        uint256 bpsAfter;
        uint256 navBefore;
        uint256 navAfter;
        uint256 ts;
    }

    address public owner;
    address public vault;
    Entry[] public entries;

    event Logged(
        uint256 indexed seq,
        uint256 priceE8,
        uint256 bpsBefore,
        uint256 bpsAfter,
        uint256 navBefore,
        uint256 navAfter,
        uint256 ts
    );

    constructor(address _owner) {
        owner = _owner;
    }

    function setVault(address _vault) external {
        require(msg.sender == owner, "log: not owner");
        require(vault == address(0), "log: vault already set");
        require(_vault != address(0), "log: zero vault");
        vault = _vault;
    }

    function record(
        uint256 priceE8,
        uint256 bpsBefore,
        uint256 bpsAfter,
        uint256 navBefore,
        uint256 navAfter
    ) external {
        require(msg.sender == vault, "log: not vault");
        entries.push(Entry({
            priceE8: priceE8,
            bpsBefore: bpsBefore,
            bpsAfter: bpsAfter,
            navBefore: navBefore,
            navAfter: navAfter,
            ts: block.timestamp
        }));
        emit Logged(entries.length - 1, priceE8, bpsBefore, bpsAfter, navBefore, navAfter, block.timestamp);
    }

    function count() external view returns (uint256) {
        return entries.length;
    }
}
