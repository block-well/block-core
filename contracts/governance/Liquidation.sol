// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import {ILiquidation} from "../interfaces/ILiquidation.sol";
import {IBtcRater} from "../interfaces/IBtcRater.sol";
import {SATS} from "../system/SATS.sol";

contract Liquidation is ILiquidation {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for SATS;

    SATS public immutable sats;
    IBtcRater public immutable btcRater;
    address public immutable keeperRegistryAddress;
    uint256 public immutable startTimestamp;
    uint256 public immutable duration;
    uint256 private constant PRECISE_UNIT = 1e18;

    constructor(
        address _sats,
        address _btcRater,
        address _registryAddr,
        uint256 _startTimestamp,
        uint256 _duration
    ) {
        sats = SATS(_sats);
        btcRater = IBtcRater(_btcRater);
        keeperRegistryAddress = _registryAddr;
        startTimestamp = _startTimestamp;
        duration = _duration; //20 days, 20*24*3600=1728000
    }

    function receiveFund(address asset, uint256 amount) external override {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        emit InitialData(startTimestamp, duration, asset, amount);
    }

    function discountPrice(uint256 timestamp) external view returns (uint256) {
        return _discountPrice(timestamp);
    }

    function _discountPrice(uint256 timestamp) private view returns (uint256) {
        if (timestamp <= startTimestamp) return PRECISE_UNIT;
        return PRECISE_UNIT.sub((timestamp.sub(startTimestamp)).mul(PRECISE_UNIT).div(duration));
    }

    function calcDiscountSatsAmount(address asset, uint256 amount) public view returns (uint256) {
        uint256 normalizedAmount = btcRater.calcAmountInWei(asset, amount);
        uint256 satsAmount = btcRater.calcOrigAmount(address(sats), normalizedAmount);
        uint256 price = _discountPrice(block.timestamp);
        uint256 discountSatsAmount = satsAmount.mul(price).div(PRECISE_UNIT);
        return discountSatsAmount;
    }

    function assetAuction(address asset, uint256 amount) external {
        require(block.timestamp >= startTimestamp, "auction not start");
        uint256 discountSatsAmount = calcDiscountSatsAmount(asset, amount);
        sats.safeTransferFrom(msg.sender, keeperRegistryAddress, discountSatsAmount);
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit AssetAuctioned(msg.sender, asset, amount, discountSatsAmount);
    }
}
