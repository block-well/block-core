// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFee is ISwapFee, Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint8 private _mintFeeBps;
    uint8 private _burnFeeBps;
    uint16 private _mintFeeGasPrice; // in gwei
    uint32 private _mintFeeGasUsed;
    IERC20 public immutable sats;

    event SatsCollected(address indexed to, address indexed asset, uint256 amount);
    event EtherCollected(address indexed to, uint256 amount);

    //================================= Public =================================
    constructor(
        uint8 mintFeeBps,
        uint8 burnFeeBps,
        uint16 mintFeeGasPrice,
        uint32 mintFeeGasUsed,
        IERC20 _sats
    ) {
        _mintFeeBps = mintFeeBps;
        _burnFeeBps = burnFeeBps;
        _mintFeeGasUsed = mintFeeGasUsed;
        _mintFeeGasPrice = mintFeeGasPrice;
        sats = _sats;
    }

    function getMintEthFee() public view override returns (uint256) {
        return 1e9 * uint256(_mintFeeGasUsed) * uint256(_mintFeeGasPrice);
    }

    function getMintFeeBps() external view override returns (uint8) {
        return _mintFeeBps;
    }

    function getBurnFeeBps() external view override returns (uint8) {
        return _burnFeeBps;
    }

    function updateMintEthGasUsed(uint32 gasUsed) external override onlyOwner {
        _mintFeeGasUsed = gasUsed;

        emit MintEthFeeUpdate(gasUsed, _mintFeeGasPrice);
    }

    function updateMintEthGasPrice(uint16 gasPrice) external override onlyOwner {
        _mintFeeGasPrice = gasPrice;

        emit MintEthFeeUpdate(_mintFeeGasUsed, gasPrice);
    }

    function updateMintFeeBps(uint8 bps) external override onlyOwner {
        _mintFeeBps = bps;

        emit MintFeeBpsUpdate(bps);
    }

    function updateBurnFeeBps(uint8 bps) external override onlyOwner {
        _burnFeeBps = bps;

        emit MintFeeBpsUpdate(bps);
    }

    function getMintFeeAmount(uint256 amount) external view override returns (uint256) {
        return amount.mul(_mintFeeBps).div(10000);
    }

    function getBurnFeeAmount(uint256 amount) public view override returns (uint256) {
        return amount.mul(_burnFeeBps).div(10000);
    }

    function payMintEthFee() external payable override {
        require(msg.value >= getMintEthFee(), "not enough eth");
    }

    function payExtraMintFee(address, uint256 amount) external view override returns (uint256) {
        // potentially to receive dcs
        return amount.mul(_mintFeeBps).div(10000);
    }

    function payExtraBurnFee(address, uint256 amount) external view override returns (uint256) {
        // potentially to receive dcs
        return amount.mul(_burnFeeBps).div(10000);
    }

    function collectSats(uint256 amount) public onlyOwner {
        sats.safeTransfer(msg.sender, amount);
        emit SatsCollected(msg.sender, address(sats), amount);
    }

    function collectEther(address payable to, uint256 amount) public onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit EtherCollected(to, amount);
    }
}
