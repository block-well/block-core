// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface ISwapFee {
    function getMintFeeBps() external view returns (uint8);

    function getBurnFeeBps() external view returns (uint8);

    function updateMintFeeBps(uint8 bps) external;

    function updateBurnFeeBps(uint8 bps) external;

    function getMintFeeAmount(uint256 amount) external view returns (uint256);

    function getBurnFeeAmount(uint256 amount) external view returns (uint256);

    function payExtraMintFee(address from, uint256 amount) external returns (uint256);

    function payExtraBurnFee(address from, uint256 amount) external returns (uint256);

    event MintFeeBpsUpdate(uint8 bps);

    event BurnFeeBpsUpdate(uint8 bps);
}
