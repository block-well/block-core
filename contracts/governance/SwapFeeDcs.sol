// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;
pragma experimental ABIEncoderV2;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeDcs is ISwapFee,Initializable, OwnableUpgradeable, UUPSUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint16 public  mintFeeGasPrice; // in gwei
    uint32 public  mintFeeGasUsed;
    IERC20 public  dcs;
    uint256 public  burnFeeDcs;
    address public system;
  
  
    //================================= Public =================================

    function initialize(  uint256 _burnFeeDcs,
        uint16 _mintFeeGasPrice,
        uint32 _mintFeeGasUsed,
        IERC20 _dcs,
        address _system) public initializer {
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
        burnFeeDcs = _burnFeeDcs;
        dcs = _dcs;
        system = _system;
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
}