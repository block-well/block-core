// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract StakingReward is ReentrancyGuard {
    using SafeMath for uint256;
    using Math for uint256;

    IERC20 public immutable rewardToken;
    IERC20 public immutable stakeToken;
    uint256 public immutable startTimestamp;
    uint256 public immutable endTimestamp;
    address public immutable owner;
    uint256 private constant PRECISE_UNIT = 1e18;

    uint256 public rate;
    uint256 public lastTimestamp;
    uint256 public globalDivident; // divident per stake
    uint256 public totalStakes;
    mapping(address => uint256) public stakes;
    mapping(address => uint256) public userDivident;
    mapping(address => uint256) public claimableRewards;

    event RateUpdated(uint256 oldRate, uint256 newRate);
    event Deposit(address indexed user, uint256 amount, uint256 rewards, uint256 globalDivident);
    event Withdraw(address indexed user, uint256 amount, uint256 rewards, uint256 globalDivident);
    event ClaimRewards(address indexed user, uint256 rewards, uint256 globalDivident);

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
        owner = msg.sender;
    }

    function calGlobalDivident() public view returns (uint256) {
        (uint256 newDivident, ) = _calGlobalDivident(block.timestamp);
        return globalDivident.add(newDivident);
    }

    function updateRate(uint256 _rate) external {
        require(msg.sender == owner, "require owner");
        require(_rate != rate, "same rate");

        _updateGlobalDivident();

        uint256 remainingTime = endTimestamp.sub(startTimestamp.max(block.timestamp));
        if (_rate > rate) {
            uint256 rewardDifference = (_rate - rate).mul(remainingTime);
            rewardToken.transferFrom(msg.sender, address(this), rewardDifference);
        } else {
            uint256 rewardDifference = (rate - _rate).mul(remainingTime);
            rewardToken.transfer(msg.sender, rewardDifference);
        }

        emit RateUpdated(rate, _rate);

        rate = _rate;
    }

    function depositAndClaim(uint256 amount) external nonReentrant returns (uint256 rewards) {
        _updateGlobalDivident();
        rewards = _claimRewards(msg.sender);
        _deposit(msg.sender, amount);

        emit Deposit(msg.sender, amount, rewards, globalDivident);
    }

    function withdrawAndClaim(uint256 amount) external nonReentrant returns (uint256 rewards) {
        _updateGlobalDivident();
        rewards = _claimRewards(msg.sender);
        _withdraw(msg.sender, amount);

        emit Withdraw(msg.sender, amount, rewards, globalDivident);
    }

    function claimRewards() external nonReentrant returns (uint256 rewards) {
        _updateGlobalDivident();
        rewards = _claimRewards(msg.sender);

        emit ClaimRewards(msg.sender, rewards, globalDivident);
    }

    function _claimRewards(address account) private returns (uint256 rewards) {
        uint256 _globalDivident = globalDivident;

        rewards = _multiplyDecimalPrecise(
            stakes[account],
            _globalDivident.sub(userDivident[account])
        );

        // update per-user state
        userDivident[account] = _globalDivident;

        if (rewards > 0) {
            rewardToken.transfer(account, rewards);
        }
    }

    function _deposit(address account, uint256 amount) private {
        stakeToken.transferFrom(account, address(this), amount);
        totalStakes = totalStakes.add(amount);
        stakes[account] = stakes[account].add(amount);
    }

    function _withdraw(address account, uint256 amount) private {
        stakeToken.transfer(account, amount);
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
