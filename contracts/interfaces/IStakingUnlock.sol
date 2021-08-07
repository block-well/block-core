// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingUnlock {
    struct LpConfig {
        uint256 speed;
        uint256 minTimespan;
    }

    struct UserStakeRecord {
        uint256 amount;
        uint256 lpSpeed;
        uint256 maxSpeed;
        uint256 lastTimestamp;
        IERC20 lp;
    }

    event SetLpConfig(address lp, uint256 speed, uint256 minTimespan);
    event DepositLocked(address issuer, address user, uint256 amount, uint256 unlockAmount);
    event Stake(address user, address lp, uint256 stakeAmount, uint256 unlockAmount);
    event UnStake(address user, address lp, uint256 stakeAmount, uint256 unlockAmount);
    event Claim(address user, address lp, uint256 stakeAmount, uint256 unlockAmount);

    function depositLocked(address user, uint256 amount) external returns (uint256 unlockAmount);

    function stake(IERC20 lp, uint256 amount) external returns (uint256 unlockAmount);

    function unstake(IERC20 lp, uint256 amount) external returns (uint256 unlockAmount);

    function claim() external returns (uint256 unlockAmount);
}
