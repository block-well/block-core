// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";


import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeSats is ISwapFee, OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public burnFeeDcs;
    IERC20Upgradeable public dcs;
    address public system;
    uint32 public mintFeeGasUsed;
    uint16 public mintFeeGasPrice; // in gwei
    uint8 public mintFeeBps;
    uint8 public burnFeeBps;
    IERC20Upgradeable public sats;

    //================================= Public =================================
    function initialize(
        uint32 _mintFeeGasUsed,
        uint16 _mintFeeGasPrice,
        uint8 _mintFeeBps,
        uint8 _burnFeeBps,
        IERC20Upgradeable _sats
    ) public initializer {
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
        mintFeeBps = _mintFeeBps;
        burnFeeBps = _burnFeeBps;
        sats = _sats;
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

    function collectSats(uint256 amount) public onlyOwner {
        sats.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(sats), amount);
    }

    function collectEther(address payable to, uint256 amount) public onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     *
     * Add new variables please refer to the link
     * See https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#modifying-your-contracts
     */
    uint256[49] private __gap;
}
