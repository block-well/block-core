// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;


import {ISwapFee} from "../interfaces/ISwapFee.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";


contract SwapFeeDcsUpgradeable is ISwapFee, UUPSUpgradeable, OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint16 public  mintFeeGasPrice; // in gwei
    uint32 public  mintFeeGasUsed;
    uint256 public  burnFeeDcs;
    IERC20Upgradeable public  dcs;
    address public system;

    //================================= Public =================================
     function initialize( uint256 _burnFeeDcs,
        uint16 _mintFeeGasPrice,
        uint32 _mintFeeGasUsed,
        IERC20Upgradeable _dcs,
        address _system) public initializer {
        __Ownable_init();

        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
        burnFeeDcs = _burnFeeDcs;
        dcs = _dcs;
        system = _system;
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function getMintEthFee() public view virtual override returns (uint256) {
        return 1e9 * uint256(mintFeeGasUsed) * uint256(mintFeeGasPrice);
    }

    function getMintFeeAmount(uint256) external view virtual  override returns (uint256) {
        return 0;
    }

    function getBurnFeeAmount(uint256) public view virtual  override returns (uint256) {
        return 0;
    }

    function payMintEthFee() external virtual payable override {
        require(msg.value >= getMintEthFee(), "not enough eth");
    }

    function payExtraMintFee(address, uint256) external view virtual override returns (uint256) {
        return 0;
    }

    function payExtraBurnFee(address from, uint256) external virtual override returns (uint256) {
        require(msg.sender == system, "only system");
        dcs.safeTransferFrom(from, address(this), burnFeeDcs);
        return 0;
    }

    function collectDcs(uint256 amount) public onlyOwner {
        dcs.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(dcs), amount);
    }

    function collectEther(address payable to, uint256 amount) public virtual onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }
}
