// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import "./SwapFeeDcsUpgradeable.sol";

contract SwapFeeSatsUpgradeable is  SwapFeeDcsUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    
    // 新的变量
    uint8 public  mintFeeBps;
    uint8 public  burnFeeBps;
    IERC20Upgradeable public  sats;

    //================================= Public =================================
    function upgradeIntianlization(
        uint8 _mintFeeBps,
        uint8 _burnFeeBps,
        uint16 _mintFeeGasPrice,
        uint32 _mintFeeGasUsed,
        IERC20Upgradeable _sats
    ) external  onlyOwner {
        mintFeeBps = _mintFeeBps;
        burnFeeBps = _burnFeeBps;
        mintFeeGasUsed = _mintFeeGasUsed;
        mintFeeGasPrice = _mintFeeGasPrice;
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

    function collectEther(address payable to, uint256 amount) public override onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }
}
