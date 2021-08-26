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

    uint8 public mintFeeBps;
    uint8 public burnFeeBps;
    uint16 public mintFeeGasPrice; // in gwei
    uint32 public mintFeeGasUsed;
    IERC20 public immutable sats;

    event SatsCollected(address indexed to, address indexed asset, uint256 amount);
    event EtherCollected(address indexed to, uint256 amount);

    //================================= Public =================================
    constructor(
        uint8 _mintFeeBps,
        uint8 _burnFeeBps,
        uint16 _mintFeeGasPrice,
        uint32 _mintFeeGasUsed,
        IERC20 _sats
    ) {
        mintFeeBps = _mintFeeBps;
        burnFeeBps = _burnFeeBps;
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
        sats = _sats;
    }

    function getMintEthFee() public view override returns (uint256) {
        return 1e9 * uint256(mintFeeGasUsed) * uint256(mintFeeGasPrice);
    }

    function updateMintEthGasUsed(uint32 gasUsed) external override onlyOwner {
        mintFeeGasUsed = gasUsed;
        emit MintEthFeeUpdate(gasUsed, mintFeeGasPrice);
    }

    function updateMintEthGasPrice(uint16 gasPrice) external override onlyOwner {
        mintFeeGasPrice = gasPrice;
        emit MintEthFeeUpdate(mintFeeGasUsed, gasPrice);
    }

    function updateMintFeeBps(uint8 bps) external override onlyOwner {
        mintFeeBps = bps;
        emit MintFeeBpsUpdate(bps);
    }

    function updateBurnFeeBps(uint8 bps) external override onlyOwner {
        burnFeeBps = bps;
        emit MintFeeBpsUpdate(bps);
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
        // potentially to receive dcs
        return amount.mul(mintFeeBps).div(10000);
    }

    function payExtraBurnFee(address, uint256 amount) external view override returns (uint256) {
        // potentially to receive dcs
        return amount.mul(burnFeeBps).div(10000);
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
