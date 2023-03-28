// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Vesting is Ownable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct UserVesting {
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 totalVesting;
        uint256 totalClaimed;
        uint256 initialClaimable;
        uint256 pausedTimestamp;
    }

    IERC20 public immutable rewardToken;
    mapping(address => UserVesting) public userVesting;

    event AddVesting(
        address indexed user,
        uint256 startTimestamp,
        uint256 endTimestamp,
        uint256 totalVesting,
        uint256 initialClaimable
    );
    event Claim(address indexed user, uint256 amount);
    event TogglePause(address indexed user, uint256 timestamp);

    constructor(IERC20 _rewardToken) {
        rewardToken = _rewardToken;
    }

    function addVesting(
        address user,
        uint256 startTimestamp,
        uint256 endTimestamp,
        uint256 totalVesting,
        uint256 initialClaimable
    ) external onlyOwner {
        require(initialClaimable < totalVesting, "invalid initialClaimable");
        UserVesting storage vesting = userVesting[user];
        vesting.startTimestamp = startTimestamp;
        vesting.endTimestamp = endTimestamp;
        vesting.totalVesting = totalVesting;
        if (initialClaimable > 0) vesting.initialClaimable = initialClaimable;

        rewardToken.safeTransferFrom(msg.sender, address(this), totalVesting);
        emit AddVesting(user, startTimestamp, endTimestamp, totalVesting, initialClaimable);
    }

    function claim() external nonReentrant returns (uint256 claimable) {
        UserVesting storage vesting = userVesting[msg.sender];
        uint256 timestamp = vesting.pausedTimestamp;
        if (timestamp == 0) {
            timestamp = block.timestamp;
        }
        uint256 totalClaimed = vesting.totalClaimed;
        claimable = _totalVestedOf(vesting, timestamp).sub(totalClaimed);
        vesting.totalClaimed = totalClaimed.add(claimable);
        rewardToken.safeTransfer(msg.sender, claimable);

        emit Claim(msg.sender, claimable);
    }

    function togglePause(address user) external onlyOwner {
        UserVesting storage vesting = userVesting[user];
        if (vesting.pausedTimestamp == 0) {
            vesting.pausedTimestamp = block.timestamp;
        } else {
            vesting.pausedTimestamp = 0;
        }
        emit TogglePause(user, vesting.pausedTimestamp);
    }

    function vestedSupply(address user) external view returns (uint256) {
        return _totalVestedOf(userVesting[user], block.timestamp);
    }

    function lockedSupply(address user) external view returns (uint256) {
        UserVesting storage vesting = userVesting[user];
        return vesting.totalVesting.sub(_totalVestedOf(vesting, block.timestamp));
    }

    function _totalVestedOf(UserVesting storage vesting, uint256 timestamp)
        internal
        view
        returns (uint256)
    {
        uint256 start = vesting.startTimestamp;
        uint256 end = vesting.endTimestamp;
        uint256 locked = vesting.totalVesting;
        if (timestamp < start) {
            return 0;
        } else if (timestamp > end) {
            return locked;
        }
        uint256 vestedAtStart_ = vesting.initialClaimable;
        return
            locked.sub(vestedAtStart_).mul(timestamp - start).div(end - start).add(vestedAtStart_);
    }
}
