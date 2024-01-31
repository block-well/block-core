// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeDcs is ISwapFee, OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint256 public burnFeeDcs;
    IERC20Upgradeable public dcs;
    address public system;
    uint32 public mintFeeGasUsed;
    uint16 public mintFeeGasPrice; // in gwei


    //================================= Public =================================
    function initialize(
        uint256 _burnFeeDcs,
        IERC20Upgradeable _dcs,
        address _system,
        uint32 _mintFeeGasUsed,
        uint16 _mintFeeGasPrice
    ) public initializer {
        burnFeeDcs = _burnFeeDcs;
        dcs = _dcs;
        system = _system;
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
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
        dcs.safeTransferFrom(from, address(this), burnFeeDcs);
        return 0;
    }

    function collectDcs(uint256 amount) public onlyOwner {
        dcs.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(dcs), amount);
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
    uint256[50] private __gap;
}
