// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {IBtcRater} from "./interfaces/IBtcRater.sol";
import {BtcUtility} from "./utils/BtcUtility.sol";

interface IERC20Extension {
    function decimals() external view returns (uint8);
}

contract BtcRater is Ownable, IBtcRater {
    using SafeMath for uint256;

    mapping(address => uint256) public btcConversionRates; // For homogeneous BTC asset, the rate is 1. For Cong, the rate is 1e8

    constructor(address[] memory assets, uint256[] memory rates) public {
        for (uint256 i = 0; i < assets.length; i++) {
            btcConversionRates[assets[i]] = rates[i];
        }
    }

    function updateRates(address asset, uint256 rate) external onlyOwner {
        btcConversionRates[asset] = rate;
    }

    function calcValueInSatoshi(address asset, uint256 amount)
        external
        view
        override
        returns (uint256)
    {
        // e.g. wbtc&1e8, returns 1e8
        // e.g. hbtc&1e18, returns 1e8
        // e.g. cong&1e18, returns 1e8
        uint256 valueInSatoshiDecimal =
            amount.div(BtcUtility.getSatoshiDivisor(IERC20Extension(asset).decimals()));
        return valueInSatoshiDecimal.div(btcConversionRates[asset]);
    }

    function calcValueInWei(address asset, uint256 amount)
        external
        view
        override
        returns (uint256)
    {
        // e.g. wbtc&1e8, returns 1e18
        // e.g. hbtc&1e18, returns 1e18
        // e.g. cong&1e18, returns 1e18
        uint256 valueInWeiDecimal =
            amount.mul(BtcUtility.getWeiMultiplier(IERC20Extension(asset).decimals()));
        return valueInWeiDecimal.div(btcConversionRates[asset]);
    }

    function getConversionRate(address asset) external view override returns (uint256) {
        return btcConversionRates[asset];
    }
}
