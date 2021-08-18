// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

interface ILiquidation {
    function receiveFund(address asset, uint256 amount) external;

    event AssetAuctioned(
        address operator,
        address asset,
        uint256 amount,
        uint256 discountSatsAmount
    );

    event InitialData(
        uint256 startTimestamp,
        uint256 duration,
        address asset,
        uint256 initialAmount
    );
}
