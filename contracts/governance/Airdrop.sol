// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IStakingUnlock.sol";
import "hardhat/console.sol";

contract Airdrop is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    bytes32 public merkleRoot;

    IStakingUnlock public immutable stakingUnlock;
    IERC20 public immutable rewardToken;
    uint256 public immutable deadline;
    // address public immutable owner;
    mapping(uint256 => bool) public claimed;

    event Claim(address user, uint256 index, uint256 amount);
    event Refund(uint256 amount);
    event UpdateMerkleRoot(bytes32 newMerkleRoot);

    constructor(
        IStakingUnlock _stakingUnlock,
        IERC20 _rewardToken,
        bytes32 _merkleRoot,
        uint256 _deadline
    ) {
        // owner = msg.sender;
        stakingUnlock = _stakingUnlock;
        rewardToken = _rewardToken;
        merkleRoot = _merkleRoot;
        deadline = _deadline;
    }

    function updateMerkleRoot(bytes32 newMerkleRoot) external onlyOwner {
        merkleRoot = newMerkleRoot;
        emit UpdateMerkleRoot(newMerkleRoot);
    }

    /*
    function claim() external nonReentrant returns (uint256 claimable) { // user: from airdrop to stakingUnlock
        require(block.timestamp <= deadline, "only before deadline");
        require(!claimed[msg.sender], "already claimed");

        claimable = _claimRewards(msg.sender);

        _stakeUnlock(msg.sender, claimable);

        emit Claim(msg.sender, claimable);
    }
    */
    function claim(
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant returns (bool flag) {
        // user: from airdrop to stakingUnlock
        require(block.timestamp <= deadline, "only before deadline");
        require(!claimed[index], "already claimed");

        claimed[index] = true;

        flag = _claimRewards(msg.sender, index, amount, merkleProof);
        require(flag, "wrong Merkle proof");

        _stakeUnlock(msg.sender, amount);

        emit Claim(msg.sender, index, amount);
    }

    function refund() external nonReentrant onlyOwner returns (uint256 amount) {
        // owner: refund after deadline
        // require(msg.sender == owner, "only owner");
        require(block.timestamp > deadline, "only after deadline");

        amount = rewardToken.balanceOf(address(this));
        rewardToken.safeTransfer(owner(), amount);

        emit Refund(amount);
    }

    function _claimRewards(
        address user,
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) private view returns (bool flag) {
        bytes32 leaf = keccak256(abi.encodePacked(index, user, amount));
        flag = MerkleProof.verify(merkleProof, merkleRoot, leaf);
        // console.logBytes32(leaf);
    }

    /*
    function _claimRewards(address user) private returns (uint256 amount) {
        amount = 1600e18;
        claimed[user] = true;
    }
    */
    function _stakeUnlock(address user, uint256 amount) private {
        rewardToken.approve(address(stakingUnlock), amount);
        stakingUnlock.depositLocked(user, amount);
    }
}
