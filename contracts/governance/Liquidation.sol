// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import {SATS} from "../system/SATS.sol";
import {IBtcRater} from "../interfaces/IBtcRater.sol";

contract Liquidation is Ownable {
    using SafeMath for uint256;

    SATS public immutable sats;
    IBtcRater public immutable btcRater;
    uint256 private startTimeStamp;
    uint32 private INTERVAL; //hours
    uint32 private REDUCE; //千分之

    constructor(address _sats, address _btcRater) {
        sats = SATS(_sats);
        btcRater = IBtcRater(_btcRater);
    }

    function initLiquidation(uint256 timeStamp) external onlyOwner {
        startTimeStamp = timeStamp;
    }

    function getStartTime() public view returns (uint256) {
        return startTimeStamp;
    }

    function setRegulation(uint32 interval, uint32 reduce) external onlyOwner {
        //每几(interval)小时减少千分之几(reduce)
        INTERVAL = interval;
        REDUCE = reduce;
    }

    function getRegulation() public view returns (uint32, uint32) {
        return (INTERVAL, REDUCE);
    }

    function getPriceAfterDiscount(address asset, uint256 amount) public view returns (uint256) {
        require(block.timestamp >= startTimeStamp, "auction not start");
        uint256 normalizedAmount = btcRater.calcAmountInWei(asset, amount);
        uint256 duration = block.timestamp.sub(startTimeStamp).div(3600);
        uint256 reduce = normalizedAmount.mul(duration).div(INTERVAL).mul(REDUCE).div(1000);
        return normalizedAmount.sub(reduce);
    }

    function assetAuction(address asset, uint256 amount) public {
        require(block.timestamp >= startTimeStamp, "auction not start");

        // require(IERC20(asset).balanceOf(address(this)) >= amount, "not enough asset balance");

        uint256 price = getPriceAfterDiscount(asset, amount);
        // require(sats.balanceOf(msg.sender) >= price, "not enough SATS balance");

        require(sats.transferFrom(msg.sender, address(this), price), "transfer SATS failed");
        require(IERC20(asset).transfer(msg.sender, amount), "transfer asset failed");

        emit AssetAuctioned(msg.sender, asset, amount, price);
    }

    event AssetAuctioned(address operator, address asset, uint256 amount, uint256 price);
}
