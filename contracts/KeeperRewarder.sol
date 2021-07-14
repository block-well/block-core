// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract KeeperRewarder is ReentrancyGuard {
    using SafeMath for uint256;
    using Math for uint256;

    IERC20 public immutable dcs;
    IERC20 public immutable stakeToken;
    uint256 public immutable startTimestamp;
    uint256 public immutable endTimestamp;
    address public immutable owner;
    uint256 private constant PRECISE_UNIT = 1e18;

    uint256 public rate;
    uint256 public lastTimestamp;
    uint256 public eps; // earnings per stake
    uint256 public totalStakes;
    mapping(address => uint256) public stakes;
    mapping(address => uint256) public userEps;
    mapping(address => uint256) public claimableRewards;

    event RateUpdated(uint256 oldRate, uint256 newRate);

    constructor(
        IERC20 _dcs,
        IERC20 _stakeToken,
        uint256 _startTimestamp,
        uint256 _endTimestamp
    ) {
        require(_startTimestamp >= block.timestamp, "Start cannot be in the past");
        dcs = _dcs;
        stakeToken = _stakeToken;
        startTimestamp = _startTimestamp;
        endTimestamp = _endTimestamp;
        owner = msg.sender;
    }

    function updateRate(uint256 _rate) external {
        require(msg.sender == owner, "require owner");
        require(_rate != rate, "same rate");

        _checkpoint();

        uint256 remainingTime = endTimestamp.sub(startTimestamp.max(block.timestamp));
        if (_rate > rate) {
            uint256 rewardDifference = (_rate - rate).mul(remainingTime);
            dcs.transferFrom(msg.sender, address(this), rewardDifference);
        } else {
            uint256 rewardDifference = (rate - _rate).mul(remainingTime);
            dcs.transfer(msg.sender, rewardDifference);
        }

        emit RateUpdated(rate, _rate);

        rate = _rate;
    }

    function userCheckpoint(address account) public {
        _checkpoint();
        _rewardCheckpoint(account);
    }

    function deposit(uint256 amount) external nonReentrant {
        userCheckpoint(msg.sender);

        stakeToken.transferFrom(msg.sender, address(this), amount);
        totalStakes = totalStakes.add(amount);
        stakes[msg.sender] = stakes[msg.sender].add(amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        userCheckpoint(msg.sender);
        _withdraw(msg.sender, amount);
    }

    function exit() external nonReentrant returns (uint256 rewards) {
        userCheckpoint(msg.sender);
        _withdraw(msg.sender, stakes[msg.sender]);
        rewards = _claimRewards(msg.sender);
    }

    function claimRewards() external nonReentrant returns (uint256 rewards) {
        userCheckpoint(msg.sender);
        rewards = _claimRewards(msg.sender);
    }

    function _claimRewards(address account) private returns (uint256 rewards) {
        rewards = claimableRewards[account];
        dcs.transfer(account, rewards);
        delete claimableRewards[account];
    }

    function _withdraw(address account, uint256 amount) private {
        stakeToken.transfer(account, amount);
        totalStakes = totalStakes.sub(amount, "Exceed staked balances");
        stakes[account] = stakes[account].sub(amount, "Exceed staked balances");
    }

    function _checkpoint() private {
        // Skip if before start timestamp
        if (block.timestamp < startTimestamp) return;

        uint256 nextTimestamp = endTimestamp.min(block.timestamp);
        uint256 timeLapse = nextTimestamp.sub(lastTimestamp);
        if (timeLapse != 0) {
            uint256 _totalStakes = totalStakes;
            if (_totalStakes != 0) {
                eps = eps.add(_divideDecimalPrecise(rate.mul(timeLapse), _totalStakes));
            }

            // update global state
            lastTimestamp = nextTimestamp;
        }
    }

    function _rewardCheckpoint(address account) private {
        // claim rewards till now
        uint256 claimableReward = _multiplyDecimalPrecise(
            stakes[account],
            eps.sub(userEps[account])
        );
        if (claimableReward > 0) {
            claimableRewards[account] = claimableRewards[account].add(claimableReward);
        }

        // update per-user state
        userEps[account] = eps;
    }

    function _divideDecimalPrecise(uint256 x, uint256 y) internal pure returns (uint256) {
        return x.mul(PRECISE_UNIT).div(y);
    }

    function _multiplyDecimalPrecise(uint256 x, uint256 y) internal pure returns (uint256) {
        return x.mul(y).div(PRECISE_UNIT);
    }
}
