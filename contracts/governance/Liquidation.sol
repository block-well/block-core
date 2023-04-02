// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {ILiquidation} from "../interfaces/ILiquidation.sol";
import {IBtcRater} from "../interfaces/IBtcRater.sol";
import {IKeeperRegistry} from "../interfaces/IKeeperRegistry.sol";

contract Liquidation is ILiquidation, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public immutable ebtc;
    IBtcRater public immutable btcRater;
    IKeeperRegistry public immutable registry;
    uint256 public immutable startTimestamp;
    uint256 public immutable duration;
    uint256 private constant PRECISE_UNIT = 1e18;

    constructor(
        IERC20 _ebtc,
        IBtcRater _btcRater,
        IKeeperRegistry _registry,
        uint256 _startTimestamp,
        uint256 _duration
    ) {
        ebtc = _ebtc;
        btcRater = _btcRater;
        registry = _registry;
        startTimestamp = _startTimestamp;
        duration = _duration; //20 days, 20*24*3600=1728000
    }

    function receiveFund(IERC20 asset, uint256 amount) external override {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit InitialData(startTimestamp, duration, address(asset), amount);
    }

    function discountPrice(uint256 timestamp) external view returns (uint256) {
        return _discountPrice(timestamp);
    }

    function _discountPrice(uint256 timestamp) private view returns (uint256) {
        if (timestamp <= startTimestamp) return PRECISE_UNIT;
        return PRECISE_UNIT.sub((timestamp.sub(startTimestamp)).mul(PRECISE_UNIT).div(duration));
    }

    function calcDiscountEbtcAmount(IERC20 asset, uint256 amount) public view returns (uint256) {
        uint256 normalizedAmount = btcRater.calcAmountInWei(address(asset), amount);
        uint256 ebtcAmount = btcRater.calcOrigAmount(address(ebtc), normalizedAmount);
        uint256 price = _discountPrice(block.timestamp);
        uint256 discountebtcAmount = ebtcAmount.mul(price).div(PRECISE_UNIT);
        return discountebtcAmount;
    }

    function assetAuction(IERC20 asset, uint256 amount, address recipient) external nonReentrant {
        require(block.timestamp >= startTimestamp, "auction not start");
        require(recipient == address(registry), "recipient not match registry");

        uint256 discountebtcAmount = calcDiscountEbtcAmount(asset, amount);
        registry.addConfiscation(msg.sender, address(ebtc), discountebtcAmount);
        asset.safeTransfer(msg.sender, amount);
        emit AssetAuctioned(msg.sender, address(asset), amount, discountebtcAmount);
    }
}
