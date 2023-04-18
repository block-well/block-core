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
    IERC20 public immutable ebtc;

    //================================= Public =================================
    constructor(uint8 _mintFeeBps, uint8 _burnFeeBps, IERC20 _ebtc) {
        mintFeeBps = _mintFeeBps;
        burnFeeBps = _burnFeeBps;
        ebtc = _ebtc;
    }

    function getMintFeeEth() public pure override returns (uint256) {
        return 1e9 * getMintFeeEthGasPrice() * getMintFeeEthGasUsed();
    }

    function getMintFeeEthGasPrice() public pure override returns (uint256) {
        return 30;
    }

    function getMintFeeEthGasUsed() public pure override returns (uint256) {
        return 300000;
    }

    function getMintFeeEbtc(uint256 amount) external view override returns (uint256) {
        return amount.mul(mintFeeBps).div(10000);
    }

    function getBurnFeeEbtc(uint256 amount) public view override returns (uint256) {
        return amount.mul(burnFeeBps).div(10000);
    }

    function getMintFeeDcx(uint256) public pure override returns (uint256) {
        return 0;
    }

    function getBurnFeeDcx(uint256) public pure override returns (uint256) {
        return 0;
    }

    function payMintFeeEth() external payable override {
        require(msg.value >= getMintFeeEth(), "not enough eth");
    }

    function payExtraMintFee(address, uint256 amount) external view override returns (uint256) {
        return amount.mul(mintFeeBps).div(10000);
    }

    function payExtraBurnFee(address, uint256 amount) external view override returns (uint256) {
        return amount.mul(burnFeeBps).div(10000);
    }

    function collectEther(address payable to, uint256 amount) public override onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }

    function collectEbtc(uint256 amount) public override onlyOwner {
        ebtc.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(ebtc), amount);
    }

    function collectDcx(uint256 amount) public override onlyOwner {}
}
