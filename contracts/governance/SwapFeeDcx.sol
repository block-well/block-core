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

    uint16 public immutable mintFeeGasPrice; // in gwei
    uint32 public immutable mintFeeGasUsed;
    uint256 public immutable burnFeeDcx;
    IERC20 public immutable dcx;
    address public system;

    //================================= Public =================================
    constructor(
        uint256 _burnFeeDcx,
        uint16 _mintFeeGasPrice,
        uint32 _mintFeeGasUsed,
        IERC20 _dcx,
        address _system
    ) {
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
        burnFeeDcx = _burnFeeDcx;
        dcx = _dcx;
        system = _system;
    }

    function getMintEthFee() public view override returns (uint256) {
        return 1e9 * uint256(mintFeeGasUsed) * uint256(mintFeeGasPrice);
    }

    function getMintFeeAmount(uint256) external pure override returns (uint256) {
        return 0;
    }

    function getBurnFeeAmount(uint256) public pure override returns (uint256) {
        return 0;
    }

    function payMintEthFee() external payable override {
        require(msg.value >= getMintEthFee(), "not enough eth");
    }

    function payExtraMintFee(address, uint256) external pure override returns (uint256) {
        return 0;
    }

    function payExtraBurnFee(address from, uint256) external override returns (uint256) {
        require(msg.sender == system, "only system");
        dcx.safeTransferFrom(from, address(this), burnFeeDcx);
        return 0;
    }

    function collectDcx(uint256 amount) public onlyOwner {
        dcx.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(dcx), amount);
    }

    function collectEther(address payable to, uint256 amount) public onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }
}
