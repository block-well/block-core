// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IFee {
    function getMintFeeBps() external view returns (uint8);

    function getBurnFeeBps() external view returns (uint8);

    function updateMintFeeBps(uint8 bps) external;

    function updateBurnFeeBps(uint8 bps) external;

    event MintFeeBpsUpdate(uint8 bps);

    event BurnFeeBpsUpdate(uint8 bps);
}
