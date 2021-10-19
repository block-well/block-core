// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract Staking {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Math for uint256;

    IERC20 public immutable stakeToken; // DODO LP Token
    IERC20 public immutable rewardToken; // DCS

    struct UserData {
        uint256 totalAmount;
        EachTimeData[] data;
    }
    struct EachTimeData {
        uint256 stakeTime;
        uint256 amount;
        uint256 timeForFee; // 每unstake一次，手续费的时间要重置
    }
    mapping(address => UserData) public usersData;
    uint256 apr = 25; // 25%
    uint256 private constant PRECISE_UNIT = 1e18;

    event Initialize(address rewardToken, address _stakeToken);
    event Staked(address user, uint256 amount);
    event Unstaked(address user, uint256 amount);

    constructor(IERC20 _stakeToken, IERC20 _rewardToken) {
        stakeToken = _stakeToken;
        rewardToken = _rewardToken;

        emit Initialize(address(_rewardToken), address(_stakeToken));
    }

    function _aprPerSecond() private view returns (uint256) {
        // 25% / 365 / 3600
        return PRECISE_UNIT.mul(apr).div(100).div(365).div(3600);
    }

    function stake(address user, uint256 amount) external {
        require(amount > 0, "stake 0 is not allowed");

        UserData storage userData = usersData[user];
        userData.totalAmount = userData.totalAmount.add(amount);
        userData.data.push(EachTimeData(block.timestamp, amount, block.timestamp));

        stakeToken.safeTransferFrom(user, address(this), amount);
        emit Staked(user, amount);
    }

    function getUserData(address user) external view returns (UserData memory) {
        return usersData[user];
    }

    function calRewardAfterFee(address user, uint256 amount) external view returns (uint256) {
        return _calRewardAfterFee(user, amount);
    }

    function _calRewardAfterFee(address user, uint256 amount) private view returns (uint256) {
        EachTimeData[] memory data = usersData[user].data;
        uint256 remain = amount;
        uint256 totalReward = 0;
        uint256 feeRate1;
        uint256 feeRate2;
        for (uint256 i = 0; i < data.length; i++) {
            uint256 amt = Math.min(remain, data[i].amount);
            uint256 reward = (block.timestamp - data[i].stakeTime).mul(_aprPerSecond());
            (feeRate1, feeRate2) = _feeRate(block.timestamp - data[i].timeForFee);
            uint256 fee = amt.mul(feeRate1).add(reward.mul(feeRate2));
            totalReward = totalReward.add(reward).sub(fee);

            if (remain > data[i].amount) remain = remain.sub(data[i].amount);
            else break;
        }
        return totalReward;
    }

    function _feeRate(uint256 duration) private pure returns (uint256, uint256) {
        // 0.75%, 2%
        if (duration <= 30) return (PRECISE_UNIT.mul(75).div(10000), PRECISE_UNIT.mul(2).div(100));
        // 0.2%, 2%
        else if (duration <= 180)
            return (PRECISE_UNIT.mul(2).div(1000), PRECISE_UNIT.mul(2).div(100));
        // 0, 2%
        else return (0, PRECISE_UNIT.mul(2).div(100));
    }

    function unstake(address user, uint256 amount) external {
        require(amount > 0, "unstake 0 is not allowed");

        UserData storage userData = usersData[user];
        require(amount <= userData.totalAmount, "unstake amount exceeds total staked amount");

        uint256 reward = _calRewardAfterFee(user, amount);

        if (amount == userData.totalAmount) {
            delete usersData[user];
        } else {
            userData.totalAmount = userData.totalAmount.sub(amount);
            _updateData(userData.data, amount);
        }

        stakeToken.safeTransfer(user, amount);
        rewardToken.safeTransfer(user, reward);

        emit Unstaked(user, amount);
    }

    function _updateData(EachTimeData[] storage data, uint256 amount) private {
        uint256 remain = amount;
        uint256 index = 0;
        // 根据amount的值，时间从前往后匹配EachTimeData
        for (uint256 i = 0; i < data.length; i++) {
            if (remain > data[i].amount) {
                remain = remain.sub(data[i].amount);
            } else if (remain == data[i].amount) {
                index = i + 1;
                break;
            } else {
                data[i].amount = data[i].amount.sub(remain);
                index = i;
                break;
            }
        }
        if (index == 0) {
            for (uint256 i = 0; i < data.length; i++) {
                data[i].timeForFee = block.timestamp; // 重置手续费时间
            }
        } else {
            // 数据前移
            EachTimeData[] storage newData;
            for (uint256 i = index; i < data.length; i++) {
                data[i].timeForFee = block.timestamp;
                newData.push(data[i]);
            }
            data = newData;
        }
    }
}
