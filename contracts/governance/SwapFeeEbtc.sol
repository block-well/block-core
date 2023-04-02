// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeEbtc is ISwapFee, Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint8 public immutable mintFeeBps;
    uint8 public immutable burnFeeBps;
    uint16 public immutable mintFeeGasPrice; // in gwei
    uint32 public immutable mintFeeGasUsed;
    IERC20 public immutable ebtc;

    //================================= Public =================================
    constructor(
        uint8 _mintFeeBps,
        uint8 _burnFeeBps,
        uint16 _mintFeeGasPrice,
        uint32 _mintFeeGasUsed,
        IERC20 _ebtc
    ) {
        mintFeeBps = _mintFeeBps;
        burnFeeBps = _burnFeeBps;
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
        ebtc = _ebtc;
    }

    function getMintEthFee() public view override returns (uint256) {
        return 1e9 * uint256(mintFeeGasUsed) * uint256(mintFeeGasPrice);
    }

    function getMintFeeAmount(uint256 amount) external view override returns (uint256) {
        return amount.mul(mintFeeBps).div(10000);
    }

    function getBurnFeeAmount(uint256 amount) public view override returns (uint256) {
        return amount.mul(burnFeeBps).div(10000);
    }

    function payMintEthFee() external payable override {
        require(msg.value >= getMintEthFee(), "not enough eth");
    }

    function payExtraMintFee(address, uint256 amount) external view override returns (uint256) {
        return amount.mul(mintFeeBps).div(10000);
    }

    function payExtraBurnFee(address, uint256 amount) external view override returns (uint256) {
        return amount.mul(burnFeeBps).div(10000);
    }

    function collectEbtc(uint256 amount) public onlyOwner {
        ebtc.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(ebtc), amount);
    }

    function collectEther(address payable to, uint256 amount) public onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }
}
