// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

interface ISwapFee {
    function getMintFeeEth() external view returns (uint256);

    function getMintFeeEthGasPrice() external view returns (uint256);

    function getMintFeeEthGasUsed() external view returns (uint256);

    function getMintFeeEbtc(uint256 amount) external view returns (uint256);

    function getBurnFeeEbtc(uint256 amount) external view returns (uint256);

    function getMintFeeDcx(uint256 amount) external view returns (uint256);

    function getBurnFeeDcx(uint256 amount) external view returns (uint256);

    function payMintFeeEth() external payable;

    function payExtraMintFee(address from, uint256 amount) external returns (uint256);

    function payExtraBurnFee(address from, uint256 amount) external returns (uint256);

    function collectEther(address payable to, uint256 amountt) external;

    function collectEbtc(uint256 amount) external;

    function collectDcx(uint256 amount) external;

    event FeeCollected(address indexed to, address indexed asset, uint256 amount);
}
