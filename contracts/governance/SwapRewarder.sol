// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {ISwapRewarder} from "../interfaces/ISwapRewarder.sol";

contract SwapRewarder is ISwapRewarder, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable dcs;
    address public immutable minter;
    uint256 public immutable mintRewardAmount;
    uint256 public immutable burnRewardAmount;

    event RewarderAbort(address indexed to, uint256 amount);

    modifier onlyMinter() {
        require(minter == msg.sender, "require system role");
        _;
    }

    constructor(
        IERC20 _dcs,
        address _minter,
        uint256 _mintRewardAmount,
        uint256 _burnRewardAmount
    ) {
        dcs = _dcs;
        minter = _minter;
        mintRewardAmount = _mintRewardAmount;
        burnRewardAmount = _burnRewardAmount;
    }

    function mintReward(address to, uint256) external override onlyMinter {
        if (mintRewardAmount == 0) return;

        dcs.safeTransfer(to, mintRewardAmount);

        emit SwapRewarded(to, mintRewardAmount, true);
    }

    function burnReward(address to, uint256) external override onlyMinter {
        if (burnRewardAmount == 0) return;

        dcs.safeTransfer(to, burnRewardAmount);

        emit SwapRewarded(to, burnRewardAmount, false);
    }

    function abort() external onlyOwner {
        uint256 balance = dcs.balanceOf(address(this));

        dcs.safeTransfer(msg.sender, balance);

        emit RewarderAbort(msg.sender, balance);
    }
}
