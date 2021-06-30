// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapRewarder} from "./interfaces/ISwapRewarder.sol";

contract SwapRewarder is ISwapRewarder {
    IERC20 public immutable dcs;
    uint256 public mintRewardAmount = 2000 * (10**18);
    uint256 public burnRewardAmount = 100 * (10**18);

    constructor(IERC20 _dcs) public {
        dcs = _dcs;
    }

    function mintReward(address to, uint256) external override {
        // amount not used right now
        dcs.transfer(to, mintRewardAmount);

        emit SwapRewarded(to, mintRewardAmount, true);
    }

    function burnReward(address to, uint256) external override {
        // amount not used right now
        dcs.transfer(to, burnRewardAmount);

        emit SwapRewarded(to, burnRewardAmount, false);
    }
}
