// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BaseStaking is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Math for uint256;

    IERC20 public immutable rewardToken;
    IERC20 public immutable stakeToken;
    uint256 public immutable startTimestamp;
    uint256 public immutable endTimestamp;
    uint256 private constant PRECISE_UNIT = 1e18;

    uint256 public rate;
    uint256 public lastTimestamp;
    uint256 public globalDivident; // divident per stake
    uint256 public totalStakes;
    mapping(address => uint256) public stakes;
    mapping(address => uint256) public userDivident;
    mapping(address => uint256) public claimableRewards;

    event UpdateRate(uint256 rate);
    event Stake(address indexed user, uint256 amount, uint256 rewards, uint256 globalDivident);
    event Unstake(address indexed user, uint256 amount, uint256 rewards, uint256 globalDivident);
    event Claim(address indexed user, uint256 rewards, uint256 globalDivident);

    constructor(
        IERC20 _rewardToken,
        IERC20 _increaseStakeAmountToken,
        uint256 _startTimestamp,
        uint256 _endTimestamp
    ) {
        require(_startTimestamp >= block.timestamp, "Start cannot be in the past");
        rewardToken = _rewardToken;
        stakeToken = _increaseStakeAmountToken;
        startTimestamp = _startTimestamp;
        lastTimestamp = _startTimestamp;
        endTimestamp = _endTimestamp;
    }

    function calGlobalDivident() public view returns (uint256) {
        (uint256 newDivident, ) = _calGlobalDivident(block.timestamp);
        return globalDivident.add(newDivident);
    }

    function updateRate(uint256 _rate) external onlyOwner {
        require(_rate != rate, "same rate");

        _updateGlobalDivident();

        uint256 remainingTime = endTimestamp.sub(startTimestamp.max(block.timestamp));
        if (_rate > rate) {
            uint256 rewardDifference = (_rate - rate).mul(remainingTime);
            rewardToken.safeTransferFrom(msg.sender, address(this), rewardDifference);
        } else {
            uint256 rewardDifference = (rate - _rate).mul(remainingTime);
            rewardToken.safeTransfer(msg.sender, rewardDifference);
        }

        emit UpdateRate(_rate);

        rate = _rate;
    }

    function _stake(address user, uint256 amount) internal returns (uint256 rewards) {
        _updateGlobalDivident();
        rewards = _settleRewards(user);
        _increaseStakeAmount(user, amount);
        emit Stake(user, amount, rewards, globalDivident);
    }

    function _unstake(address user, uint256 amount) internal returns (uint256 rewards) {
        _updateGlobalDivident();
        rewards = _settleRewards(user);
        _decreaseStakeAmount(user, amount);
        emit Unstake(user, amount, rewards, globalDivident);
    }

    function _claim(address user) internal returns (uint256 rewards) {
        _updateGlobalDivident();
        rewards = _settleRewards(user);
        emit Claim(user, rewards, globalDivident);
    }

    function _releaseReward(address keeper, uint256 rewards) internal virtual returns (uint256) {
        if (rewards > 0) rewardToken.safeTransfer(keeper, rewards);
        return rewards;
    }

    function _settleRewards(address account) internal returns (uint256 rewards) {
        uint256 _globalDivident = globalDivident;

        rewards = _multiplyDecimalPrecise(
            stakes[account],
            _globalDivident.sub(userDivident[account])
        );

        // update per-user state
        userDivident[account] = _globalDivident;

        rewards = _releaseReward(account, rewards);
    }

    function _increaseStakeAmount(address account, uint256 amount) private {
        stakeToken.safeTransferFrom(account, address(this), amount);
        totalStakes = totalStakes.add(amount);
        stakes[account] = stakes[account].add(amount);
    }

    function _decreaseStakeAmount(address account, uint256 amount) private {
        stakeToken.safeTransfer(account, amount);
        totalStakes = totalStakes.sub(amount, "Exceed staked balances");
        stakes[account] = stakes[account].sub(amount, "Exceed staked balances");
    }

    function _calGlobalDivident(uint256 currTimestamp)
        internal
        view
        returns (uint256 newDivident, uint256 nextTimestamp)
    {
        nextTimestamp = endTimestamp.min(currTimestamp);
        uint256 elapsedTime = nextTimestamp.sub(lastTimestamp);
        uint256 _totalStakes = totalStakes;
        if ((elapsedTime == 0) || (_totalStakes == 0)) {
            newDivident = 0;
        } else {
            newDivident = _divideDecimalPrecise(rate.mul(elapsedTime), _totalStakes);
        }
    }

    function _updateGlobalDivident() private {
        // Skip if before start timestamp
        if (block.timestamp < startTimestamp) return;

        (uint256 newDivident, uint256 nextTimestamp) = _calGlobalDivident(block.timestamp);

        globalDivident = globalDivident.add(newDivident);
        lastTimestamp = nextTimestamp;
    }

    function _divideDecimalPrecise(uint256 x, uint256 y) internal pure returns (uint256) {
        return x.mul(PRECISE_UNIT).div(y);
    }

    function _multiplyDecimalPrecise(uint256 x, uint256 y) internal pure returns (uint256) {
        return x.mul(y).div(PRECISE_UNIT);
    }
}
