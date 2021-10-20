// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract FixedStaking {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public immutable stakeToken; // DODO LP Token
    IERC20 public immutable rewardToken; // DCS

    struct UserData {
        uint256 stakeTime;
        uint256 amount;
    }
    mapping(address => UserData) public usersData;
    uint256 totalStaked = 0;
    uint256 private constant PRECISE_UNIT = 1e18;

    event Initialize(address rewardToken, address _stakeToken);
    event Staked(address user, uint256 amount);
    event Unstaked(address user, bool isNextStake);

    constructor(IERC20 _stakeToken, IERC20 _rewardToken) {
        stakeToken = _stakeToken;
        rewardToken = _rewardToken;

        emit Initialize(address(_rewardToken), address(_stakeToken));
    }

    function stake(address user, uint256 amount) external {
        require(totalStaked <= 1000, "1000 limit, stake finished");
        require(usersData[user].stakeTime > 0, "already staked");
        require(amount > 0, "stake 0 is not allowed");
        require(amount < 1500, "stake amount cannot exceed $1500");

        totalStaked = totalStaked.add(1);
        UserData storage userData = usersData[user];
        userData.stakeTime = block.timestamp;
        userData.amount = amount;

        stakeToken.safeTransferFrom(user, address(this), amount);
        emit Staked(user, amount);
    }

    function unstake(address user, bool isNextStake) external {
        UserData storage userData = usersData[user];
        require(block.timestamp > userData.stakeTime.add(604800), "cannot unstake within 7 days");

        uint256 reward = userData.amount.mul(PRECISE_UNIT).mul(35).div(100);

        if (isNextStake == false) {
            reward = reward.mul(98).div(100);
        }

        stakeToken.safeTransfer(user, userData.amount);
        rewardToken.safeTransfer(user, reward);

        delete usersData[user];

        emit Unstaked(user, isNextStake);
    }
}
