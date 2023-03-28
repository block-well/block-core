// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IBtcRater {
    event UpdateRates(address indexed asset, uint256 rate);

    function getConversionRate(address asset) external view returns (uint256);

    function calcAmountInWei(address asset, uint256 amount) external view returns (uint256);

    function calcOrigAmount(address asset, uint256 weiAmount) external view returns (uint256);
}
