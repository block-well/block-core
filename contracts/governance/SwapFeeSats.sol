// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeSats is ISwapFee,Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint16 public  mintFeeGasPrice; // in gwei
    uint32 public  mintFeeGasUsed;
    uint256 public  burnFeeDcs;//SwapFeeDcs 属性卡槽
    IERC20 public  dcs;  //SwapFeeDcs 属性卡槽
    address public system;//SwapFeeDcs 属性卡槽
    uint8 public  mintFeeBps; 
    uint8 public  burnFeeBps;

    //================================= Public =================================
    function initialize(   uint8 _mintFeeBps,
        uint8 _burnFeeBps,
        uint16 _mintFeeGasPrice,
        uint32 _mintFeeGasUsed,
        uint32 _burnFeeDcs,
        IERC20 _sats) public initializer {
        mintFeeBps = _mintFeeBps;
        burnFeeBps = _burnFeeBps;
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
        burnFeeDcs = _burnFeeDcs;
        dcs = _sats;
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }
    function _authorizeUpgrade(address newImplementation)
        internal
        onlyOwner
        override
    {}
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

    function collectSats(uint256 amount) public onlyOwner {
        dcs.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(dcs), amount);
    }

    function collectEther(address payable to, uint256 amount) public onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }
}