// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../interfaces/IStakingUnlock.sol";

contract Airdrop is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public immutable merkleRoot;

    IStakingUnlock public immutable stakingUnlock;
    IERC20 public immutable rewardToken;
    uint256 public immutable deadline;
    address public immutable owner;
    mapping(address => bool) public claimed;

    event Claim(address user, uint256 amount);
    event Refund(address owner, uint256 amount);

    constructor(
        IStakingUnlock _stakingUnlock,
        IERC20 _rewardToken,
        bytes32 _merkleRoot,
        uint256 _deadline
    ) {
        owner = msg.sender;
        stakingUnlock = _stakingUnlock;
        rewardToken = _rewardToken;
        merkleRoot = _merkleRoot;
        deadline = _deadline;
    }

    function claim() external nonReentrant returns (uint256 claimable) {
        require(block.timestamp <= deadline, "only before deadline");
        require(!claimed[msg.sender], "already claimed");

        claimable = _claimRewards(msg.sender);

        _stakeUnlock(msg.sender, claimable);

        emit Claim(msg.sender, claimable);
    }

    function refund() external nonReentrant returns (uint256 amount) {
        require(msg.sender == owner, "only owner");
        require(block.timestamp > deadline, "only after deadline");

        amount = rewardToken.balanceOf(address(this));
        rewardToken.safeTransfer(owner, amount);

        emit Refund(owner, amount);
    }

    function _claimRewards(address user) private returns (uint256 amount) {
        amount = 1600e18;
        claimed[user] = true;
    }

    function _stakeUnlock(address user, uint256 amount) private {
        rewardToken.approve(address(stakingUnlock), amount);
        stakingUnlock.depositLocked(user, amount);
    }
}
