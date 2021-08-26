// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

interface ISwapFee {
    function getMintEthFee() external view returns (uint256);

    function updateMintEthGasUsed(uint32 gasUsed) external;

    function updateMintEthGasPrice(uint16 gasPrice) external;

    function updateMintFeeBps(uint8 bps) external;

    function updateBurnFeeBps(uint8 bps) external;

    function getMintFeeAmount(uint256 amount) external view returns (uint256);

    function getBurnFeeAmount(uint256 amount) external view returns (uint256);

    function payMintEthFee() external payable;

    function payExtraMintFee(address from, uint256 amount) external returns (uint256);

    function payExtraBurnFee(address from, uint256 amount) external returns (uint256);

    event MintFeeBpsUpdate(uint8 bps);

    event BurnFeeBpsUpdate(uint8 bps);

    event MintEthFeeUpdate(uint32 gasUsed, uint16 gasPrice);
}
