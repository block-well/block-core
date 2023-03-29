// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract BaseStaking {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Math for uint256;

    IERC20 public immutable rewardToken;
    IERC20 public immutable stakeToken;
    uint256 public immutable startTimestamp;
    uint256 public endTimestamp;
    uint256 private constant PRECISE_UNIT = 1e18;

    uint256 public rate;
    uint256 public lastTimestamp;
    uint256 public globalDivident; // divident per stake
    uint256 public totalStakes;
    mapping(address => uint256) public stakes;
    mapping(address => uint256) public userDivident;

    event Initialize(
        address rewardToken,
        address _stakeToken,
        uint256 _startTimestamp,
        uint256 endTimestamp
    );
    event UpdateRate(uint256 rate);
    event UpdateEndTimestamp(uint256 endTimestamp);
    event Stake(address indexed user, uint256 amount, uint256 rewards, uint256 globalDivident);
    event Unstake(address indexed user, uint256 amount, uint256 rewards, uint256 globalDivident);
    event Claim(address indexed user, uint256 rewards, uint256 globalDivident);

    constructor(
        IERC20 _rewardToken,
        IERC20 _stakeToken,
        uint256 _startTimestamp,
        uint256 _endTimestamp
    ) {
        require(_startTimestamp >= block.timestamp, "Start cannot be in the past");
        rewardToken = _rewardToken;
        stakeToken = _stakeToken;
        startTimestamp = _startTimestamp;
        lastTimestamp = _startTimestamp;
        endTimestamp = _endTimestamp;

        emit Initialize(
            address(_rewardToken),
            address(_stakeToken),
            _startTimestamp,
            _endTimestamp
        );
    }

    function calGlobalDivident() public view returns (uint256) {
        (uint256 newDivident, ) = _calGlobalDivident(block.timestamp);
        return globalDivident.add(newDivident);
    }

    function _updateRate(uint256 _rate) internal {
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

    function _updateEndTimestamp(uint256 _endTimestamp) internal {
        require(
            (block.timestamp < _endTimestamp) && (block.timestamp < endTimestamp),
            "invalid endtimestamp"
        );
        if (_endTimestamp > endTimestamp) {
            uint256 rewardDifference = (_endTimestamp - endTimestamp).mul(rate);
            rewardToken.safeTransferFrom(msg.sender, address(this), rewardDifference);
        } else {
            uint256 rewardDifference = (endTimestamp - _endTimestamp).mul(rate);
            rewardToken.safeTransfer(msg.sender, rewardDifference);
        }

        endTimestamp = _endTimestamp;
        emit UpdateEndTimestamp(_endTimestamp);
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

    function _increaseStakeAmount(address account, uint256 amount) internal {
        stakeToken.safeTransferFrom(account, address(this), amount);
        totalStakes = totalStakes.add(amount);
        stakes[account] = stakes[account].add(amount);
    }

    function _decreaseStakeAmount(address account, uint256 amount) internal {
        stakeToken.safeTransfer(account, amount);
        totalStakes = totalStakes.sub(amount, "Exceed staked balances");
        stakes[account] = stakes[account].sub(amount, "Exceed staked balances");
    }

    function _calGlobalDivident(
        uint256 currTimestamp
    ) internal view returns (uint256 newDivident, uint256 nextTimestamp) {
        nextTimestamp = endTimestamp.min(currTimestamp);
        uint256 elapsedTime = nextTimestamp.sub(lastTimestamp);
        uint256 _totalStakes = totalStakes;
        if ((elapsedTime == 0) || (_totalStakes == 0)) {
            newDivident = 0;
        } else {
            newDivident = _divideDecimalPrecise(rate.mul(elapsedTime), _totalStakes);
        }
    }

    function _updateGlobalDivident() internal {
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
