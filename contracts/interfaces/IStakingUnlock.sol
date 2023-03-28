// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingUnlock {
    struct LpConfig {
        uint256 speed;
        uint256 minTimespan;
    }

    struct UserStakeRecord {
        uint256 amount;
        uint256 maxSpeed;
        uint256 lastTimestamp;
        IERC20 lp;
    }

    event SetLpConfig(address indexed lp, uint256 speed, uint256 minTimespan);
    event DepositLocked(
        address indexed issuer,
        address indexed user,
        uint256 amount,
        uint256 unlockAmount
    );
    event Stake(
        address indexed user,
        address indexed lp,
        uint256 stakeAmount,
        uint256 unlockAmount
    );
    event Unstake(
        address indexed user,
        address indexed lp,
        uint256 stakeAmount,
        uint256 unlockAmount
    );
    event Claim(
        address indexed user,
        address indexed lp,
        uint256 stakeAmount,
        uint256 unlockAmount
    );

    function depositLocked(address user, uint256 amount) external returns (uint256 unlockAmount);

    function stake(IERC20 lp, uint256 amount) external returns (uint256 unlockAmount);

    function unstake(IERC20 lp, uint256 amount) external returns (uint256 unlockAmount);

    function claim() external returns (uint256 unlockAmount);
}
