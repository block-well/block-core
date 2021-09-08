// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/drafts/EIP712.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {BaseStaking} from "./BaseStaking.sol";

contract KeeperReward is Ownable, BaseStaking, ReentrancyGuard, EIP712("KeeperReward", "1.0") {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Math for uint256;

    struct OnlineProof {
        uint256 timestamp;
        bytes32 r;
        bytes32 s;
        address keeper;
        uint8 v;
    }

    struct Accusation {
        address accuser;
        uint256 collateral;
        uint256 timestamp;
    }

    uint256 public constant TIME_BUFFER = 1 hours;
    bytes32 private constant PROOF_TYPEHASH =
        keccak256(abi.encodePacked("OnlineProof(uint256 timestamp,address keeper)"));

    address public validator;
    uint256 public accusationPenalty = 4000 ether;
    uint256 public checkinTimespan = 30 minutes;
    uint256 public absentTimespan = 18 hours;
    uint256 public appealTimespan = 12 hours;
    uint256 public immutable maxKeeperStake;
    mapping(address => uint256) public keeperPenalties;
    mapping(address => Accusation) public keeperAccusations;

    event SetValidator(address validator);
    event SetTimespan(uint256 checkin, uint256 absent, uint256 appeal);
    event SetPenalty(uint256 amount);
    event PenaltyPaid(address indexed keeper, uint256 amount);
    event Accuse(address indexed keeper, address accuser, uint256 collateral, uint256 timestamp);
    event AccuseWin(address indexed keeper, address accuser, uint256 penalty);
    event AccuseLose(address indexed keeper, address accuser, address witness, uint256 penalty);

    constructor(
        IERC20 _rewardToken,
        IERC20 _stakeToken,
        uint256 _startTimestamp,
        uint256 _endTimestamp,
        uint256 _maxKeeperStake,
        address _validator
    ) BaseStaking(_rewardToken, _stakeToken, _startTimestamp, _endTimestamp) {
        validator = _validator;
        maxKeeperStake = _maxKeeperStake;
    }

    function setValidator(address _validator) external onlyOwner {
        validator = _validator;
        emit SetValidator(_validator);
    }

    function setTimespan(
        uint256 _checkinTimespan,
        uint256 _absentTimespan,
        uint256 _appealTimespan
    ) external onlyOwner {
        checkinTimespan = _checkinTimespan;
        absentTimespan = _absentTimespan;
        appealTimespan = _appealTimespan;
        emit SetTimespan(_checkinTimespan, _absentTimespan, _appealTimespan);
    }

    function setPenalty(uint256 _penalty) external onlyOwner {
        accusationPenalty = _penalty;
        emit SetPenalty(_penalty);
    }

    function updateRate(uint256 _rate) external onlyOwner {
        _updateRate(_rate);
    }

    function updateEndTimestamp(uint256 _endTimestamp) external onlyOwner {
        _updateEndTimestamp(_endTimestamp);
    }

    function stake(uint256 amount, OnlineProof calldata proof)
        external
        nonReentrant
        returns (uint256 rewards)
    {
        Accusation storage p = keeperAccusations[proof.keeper];
        require(p.accuser == address(0), "ongoing accusation");

        _verifyProof(proof, block.timestamp.sub(checkinTimespan), block.timestamp.add(TIME_BUFFER));

        rewards = _stake(proof.keeper, amount);

        require(stakes[proof.keeper] <= maxKeeperStake, "exceed per keeper stake");
    }

    function unstake(uint256 amount, OnlineProof calldata proof)
        external
        nonReentrant
        returns (uint256 rewards)
    {
        Accusation storage p = keeperAccusations[proof.keeper];
        require(p.accuser == address(0), "ongoing accusation");

        _verifyProof(proof, block.timestamp.sub(checkinTimespan), block.timestamp.add(TIME_BUFFER));

        return _unstake(proof.keeper, amount);
    }

    function claim(OnlineProof calldata proof) external nonReentrant returns (uint256 rewards) {
        Accusation storage p = keeperAccusations[proof.keeper];
        require(p.accuser == address(0), "ongoing accusation");

        _verifyProof(proof, block.timestamp.sub(checkinTimespan), block.timestamp.add(TIME_BUFFER));

        rewards = _claim(proof.keeper);
    }

    function accuse(address keeper) external nonReentrant {
        require(stakes[keeper] > 0, "keeper not staking");

        Accusation storage p = keeperAccusations[keeper];
        require(p.accuser == address(0), "ongoing accusation");

        p.accuser = msg.sender;
        p.collateral = accusationPenalty;
        p.timestamp = block.timestamp;

        rewardToken.safeTransferFrom(msg.sender, address(this), accusationPenalty);

        emit Accuse(keeper, msg.sender, p.collateral, block.timestamp);
    }

    function appeal(OnlineProof calldata proof) external nonReentrant {
        Accusation storage p = keeperAccusations[proof.keeper];
        uint256 _accusationTime = p.timestamp;
        require(p.accuser != address(0), "no accusation");
        require(block.timestamp < _accusationTime.add(appealTimespan), "late for appeal");

        _verifyProof(proof, _accusationTime.sub(appealTimespan), _accusationTime);

        _loseAccusation(p, msg.sender);

        emit AccuseLose(proof.keeper, p.accuser, msg.sender, p.collateral);
        delete keeperAccusations[proof.keeper];
    }

    function winAccusation(address keeper) external nonReentrant {
        Accusation storage p = keeperAccusations[keeper];
        require(p.accuser != address(0), "no accusation");
        require(block.timestamp >= p.timestamp.add(appealTimespan), "wait for appeal");

        _winAccusation(p, keeper);

        emit AccuseWin(keeper, p.accuser, p.collateral);
        delete keeperAccusations[keeper];
    }

    // private
    function _verifyProof(
        OnlineProof calldata proof,
        uint256 startTime,
        uint256 endTime
    ) private view returns (bool) {
        uint256 proofTime = proof.timestamp;
        require((proofTime <= endTime) && (proofTime >= startTime), "out of time");

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(PROOF_TYPEHASH, proofTime, proof.keeper))
        );
        require(ecrecover(digest, proof.v, proof.r, proof.s) == validator, "invalid signature");
        return true;
    }

    function _winAccusation(Accusation storage p, address keeper)
        internal
        returns (uint256 rewards)
    {
        keeperPenalties[keeper] = p.collateral;
        rewardToken.safeTransfer(p.accuser, p.collateral * 2);
        rewards = _unstake(keeper, stakes[keeper]);
    }

    function _loseAccusation(Accusation storage p, address recipient) internal {
        rewardToken.safeTransfer(recipient, p.collateral);
    }

    function _releaseReward(address keeper, uint256 rewards) internal override returns (uint256) {
        uint256 penalty = keeperPenalties[keeper];
        if (rewards == 0) return 0;

        if (penalty > 0) {
            uint256 deduction = Math.min(penalty, rewards);
            keeperPenalties[keeper] = penalty.sub(deduction);
            rewards = rewards.sub(deduction);
            emit PenaltyPaid(keeper, rewards);
        }

        if (rewards > 0) rewardToken.safeTransfer(keeper, rewards);
        return rewards;
    }
}
