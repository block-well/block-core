// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract Treasury {
    using SafeMath for uint256;
    
    address SATS = 0xc766c066DE523602485746D56b6637FcE0a9A5e8;
    uint32 startTimeStamp;
    uint32 INTERVAL;  //hours
    uint32 REDUCE;  //千分之
    
    constructor() {}
    
    function initLiquidation(uint32 timeStamp) {
        startTimeStamp = timeStamp;
    }
    
    function setRegulation(uint32 interval, uint32 reduce) {
        INTERVAL = interval;
        REDUCE = reduce;
    }
    
    function getRegulation() returns (uint32, uint32) {
        return (INTERVAL, REDUCE);
    }
    
    function getPriceAfterDiscount(uint256 amount) returns (uint32) {
        return amount.mul(now.sub(startTimeStamp)).mul(INTERVAL).div(1000);
    }
    
    function assetAuction(address asset, uint256 amount) {
        require(now >= startTimeStamp, "auction not start");
        require(IERC20(asset).balanceOf(address(this)) >= amount, "not enough asset in contract");
        uint256 price = getPriceAfterDiscount(amount);
        require(IERC20(SATS).balanceOf(msg.sender) >= price, "not enough SATS balance");
        require(IERC20(SATS).transferFrom(msg.sender, address(this), price), "transfer SATS failed");
        require(asset.transfer(msg.sender, amount), "transfer asset failed");
        emit AssetAuctioned(msg.sender, asset, amount);
    }
    
    event AssetAuctioned(address operator, address asset, uint256 amount);
}