// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

interface IBtcRater {
    function getConversionRate(address asset) external view returns (uint256);

    function calcAmountInWei(address asset, uint256 amount) external view returns (uint256);

    function calcAmountInSatoshi(address asset, uint256 amount) external view returns (uint256);
}
