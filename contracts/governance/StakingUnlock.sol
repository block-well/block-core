// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IStakingUnlock.sol";

contract StakingUnlock is ReentrancyGuard, Ownable, IStakingUnlock {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Math for uint256;

    uint256 private constant PRECISE_UNIT = 1e18;

    IERC20 public immutable rewardToken;

    mapping(IERC20 => LpConfig) public lpConfig;
    mapping(address => UserStakeRecord) public userStakeRecord;
    mapping(address => uint256) public userLocked;

    constructor(IERC20 _rewardToken) {
        rewardToken = _rewardToken;
    }

    function setLpConfig(
        IERC20 lp,
        uint256 speed,
        uint256 minTimespan
    ) external onlyOwner {
        LpConfig storage config = lpConfig[lp];
        if (speed != config.speed) config.speed = speed;
        if (minTimespan != config.minTimespan) config.minTimespan = minTimespan;

        emit SetLpConfig(address(lp), speed, minTimespan);
    }

    function depositLocked(address user, uint256 amount)
        external
        override
        nonReentrant
        returns (uint256 unlockAmount)
    {
        UserStakeRecord storage rec = userStakeRecord[user];

        unlockAmount = _settleUserUnlock(user, rec);

        userLocked[user] = userLocked[user].add(amount);
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);

        if (rec.lp != IERC20(0)) _updateMaxSpeed(user, rec);

        emit DepositLocked(msg.sender, user, amount, unlockAmount);
    }

    function stake(IERC20 lp, uint256 amount)
        external
        override
        nonReentrant
        returns (uint256 unlockAmount)
    {
        LpConfig storage config = lpConfig[lp];
        require((config.speed > 0) && (config.minTimespan > 0), "unknown stake token");

        UserStakeRecord storage rec = userStakeRecord[msg.sender];
        if (rec.lp == IERC20(0)) {
            rec.lp = lp;
        } else {
            require(rec.lp == lp, "lp unmatched");
        }

        unlockAmount = _settleUserUnlock(msg.sender, rec);

        lp.safeTransferFrom(msg.sender, address(this), amount);
        rec.amount = rec.amount.add(amount);

        _updateMaxSpeed(msg.sender, rec);

        emit Stake(msg.sender, address(lp), amount, unlockAmount);
    }

    function unstake(IERC20 lp, uint256 amount)
        external
        override
        nonReentrant
        returns (uint256 unlockAmount)
    {
        LpConfig storage config = lpConfig[lp];
        require((config.speed > 0) && (config.minTimespan > 0), "unknown stake token");

        UserStakeRecord storage rec = userStakeRecord[msg.sender];
        require(rec.lp == lp, "lp unmatched");

        unlockAmount = _settleUserUnlock(msg.sender, rec);

        rec.amount = rec.amount.sub(amount);
        if (rec.amount == 0) {
            delete userStakeRecord[msg.sender];
        } else {
            _updateMaxSpeed(msg.sender, rec);
        }
        lp.safeTransfer(msg.sender, amount);

        emit UnStake(msg.sender, address(lp), amount, unlockAmount);
    }

    function claim() external override nonReentrant returns (uint256 unlockAmount) {
        UserStakeRecord storage rec = userStakeRecord[msg.sender];
        require((rec.lp != IERC20(0)), "no stake token");

        unlockAmount = _settleUserUnlock(msg.sender, rec);

        emit Claim(msg.sender, address(rec.lp), rec.amount, unlockAmount);
    }

    function _settleUserUnlock(address user, UserStakeRecord storage rec)
        private
        returns (uint256 unlockAmount)
    {
        unlockAmount = _calUnlockAmount(user, rec);

        rec.lastTimestamp = block.timestamp;
        userLocked[user] = userLocked[user].sub(unlockAmount);
        rewardToken.safeTransfer(user, unlockAmount);
    }

    function _calUnlockAmount(address user, UserStakeRecord storage rec)
        private
        view
        returns (uint256 unlockAmount)
    {
        uint256 elapsedTime = block.timestamp - rec.lastTimestamp;
        uint256 unlockSpeed = Math.min(_getLpSpeed(rec), rec.maxSpeed);
        unlockAmount = Math.min(userLocked[user], unlockSpeed.mul(elapsedTime).div(PRECISE_UNIT));
    }

    function _updateMaxSpeed(address user, UserStakeRecord storage rec) private {
        rec.maxSpeed = userLocked[user].mul(PRECISE_UNIT).div(lpConfig[rec.lp].minTimespan);
    }

    function _getLpSpeed(UserStakeRecord storage rec) private view returns (uint256) {
        return rec.amount.mul(lpConfig[rec.lp].speed);
    }
}
