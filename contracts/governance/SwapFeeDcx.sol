// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeDcx is ISwapFee, Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public immutable burnFeeDcx;
    IERC20 public immutable dcx;
    address public system;

    //================================= Public =================================
    constructor(uint256 _burnFeeDcx, IERC20 _dcx, address _system) {
        burnFeeDcx = _burnFeeDcx;
        dcx = _dcx;
        system = _system;
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

    function getMintFeeEbtc(uint256) external pure override returns (uint256) {
        return 0;
    }

    function getBurnFeeEbtc(uint256) public pure override returns (uint256) {
        return 0;
    }

    function getMintFeeDcx(uint256) public pure override returns (uint256) {
        return 0;
    }

    function getBurnFeeDcx(uint256) external view returns (uint256) {
        return burnFeeDcx;
    }

    function payMintFeeEth() external payable override {
        require(msg.value >= getMintFeeEth(), "not enough eth");
    }

    function payExtraMintFee(address, uint256) external pure override returns (uint256) {
        return 0;
    }

    function payExtraBurnFee(address from, uint256) external override returns (uint256) {
        require(msg.sender == system, "only system");
        dcx.safeTransferFrom(from, address(this), burnFeeDcx);
        return 0;
    }

    function collectEther(address payable to, uint256 amount) public override onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }

    function collectEbtc(uint256 amount) public override onlyOwner {}

    function collectDcx(uint256 amount) public override onlyOwner {
        dcx.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(dcx), amount);
    }
}
