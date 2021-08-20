// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {IBtcRater} from "../interfaces/IBtcRater.sol";
import {BtcUtility} from "../utils/BtcUtility.sol";

interface IERC20Extension {
    function decimals() external view returns (uint8);
}

contract BtcRater is Ownable, IBtcRater {
    using SafeMath for uint256;

    mapping(address => uint256) public btcConversionRates; // For homogeneous BTC asset, the rate is 1. For Sats, the rate is 1e8

    constructor(address[] memory assets, uint256[] memory rates) {
        for (uint256 i = 0; i < assets.length; i++) {
            _updateRates(assets[i], rates[i]);
        }
    }

    function updateRates(address asset, uint256 rate) external onlyOwner {
        _updateRates(asset, rate);
    }

    function _updateRates(address asset, uint256 rate) private onlyOwner {
        btcConversionRates[asset] = rate;

        emit UpdateRates(asset, rate);
    }

    function calcAmountInWei(address asset, uint256 amount)
        external
        view
        override
        returns (uint256)
    {
        // e.g. wbtc&1e8, returns 1e18
        // e.g. hbtc&1e18, returns 1e18
        // e.g. sats&1e18, returns 1e18
        uint256 valueInWeiDecimal = amount.mul(
            BtcUtility.getWeiMultiplier(IERC20Extension(asset).decimals())
        );
        return valueInWeiDecimal.div(btcConversionRates[asset]);
    }

    function calcOrigAmount(address asset, uint256 weiAmount)
        external
        view
        override
        returns (uint256)
    {
        // e.g. 1e18 => wbtc&1e8
        // e.g. 1e18 => hbtc&1e18
        // e.g. 1e18 => sats&1e18
        return
            (weiAmount.mul(btcConversionRates[asset])).div(
                BtcUtility.getWeiMultiplier(IERC20Extension(asset).decimals())
            );
    }

    function getConversionRate(address asset) external view override returns (uint256) {
        return btcConversionRates[asset];
    }
}
