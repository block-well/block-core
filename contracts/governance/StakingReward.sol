// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {BaseStaking} from "./BaseStaking.sol";

contract StakingReward is Ownable, BaseStaking, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Math for uint256;

    constructor(
        IERC20 _rewardToken,
        IERC20 _stakeToken,
        uint256 _startTimestamp,
        uint256 _endTimestamp
    ) BaseStaking(_rewardToken, _stakeToken, _startTimestamp, _endTimestamp) {}

    function updateRate(uint256 _rate) external onlyOwner {
        _updateRate(_rate);
    }

    function updateEndTimestamp(uint256 _endTimestamp) external onlyOwner {
        _updateEndTimestamp(_endTimestamp);
    }

    function stake(uint256 amount) external nonReentrant returns (uint256 rewards) {
        return _stake(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant returns (uint256 rewards) {
        return _unstake(msg.sender, amount);
    }

    function claim() external nonReentrant returns (uint256 rewards) {
        return _claim(msg.sender);
    }
}
