// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

interface ISwapFee {
    function getMintEthFee() external view returns (uint256);

    function getMintFeeAmount(uint256 amount) external view returns (uint256);

    function getBurnFeeAmount(uint256 amount) external view returns (uint256);

    function payMintEthFee() external payable;

    function payExtraMintFee(address from, uint256 amount) external returns (uint256);

    function payExtraBurnFee(address from, uint256 amount) external returns (uint256);

    event FeeCollected(address indexed to, address indexed asset, uint256 amount);
}
