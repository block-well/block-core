// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapRewarder} from "./interfaces/ISwapRewarder.sol";

contract SwapRewarder is ISwapRewarder {
    IERC20 public immutable dcs;
    address public immutable owner;
    address public immutable minter;
    uint256 public mintRewardAmount = 2000 ether;
    uint256 public burnRewardAmount = 100 ether;

    event RewarderAbort(address indexed to, uint256 amount);

    modifier onlyMinter() {
        require(minter == msg.sender, "require system role");
        _;
    }

    constructor(IERC20 _dcs, address _minter) {
        dcs = _dcs;
        minter = _minter;
        owner = msg.sender;
    }

    function mintReward(address to, uint256) external override onlyMinter {
        if (mintRewardAmount == 0) return;

        dcs.transfer(to, mintRewardAmount);

        emit SwapRewarded(to, mintRewardAmount, true);
    }

    function burnReward(address to, uint256) external override onlyMinter {
        if (burnRewardAmount == 0) return;

        dcs.transfer(to, burnRewardAmount);

        emit SwapRewarded(to, burnRewardAmount, false);
    }

    function abort() external {
        require(owner == msg.sender, "only owner");

        uint256 balance = dcs.balanceOf(address(this));

        dcs.transfer(msg.sender, balance);

        emit RewarderAbort(msg.sender, balance);
    }
}
