// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract Exchange is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public immutable btcb;
    IERC20 public immutable sats;
    address public whiteAddress;

    event WhiteAddressUpdated(address previousWhiteAddress, address newWhiteAddress);
    event Exchanged(uint256 time, uint256 amount, address operator);
    event ExchangedBack(uint256 time, uint256 amount, address operator);

    constructor(
        IERC20 _btcb,
        IERC20 _sats,
        address _whiteAddress
    ) {
        btcb = _btcb;
        sats = _sats;
        whiteAddress = _whiteAddress;
    }

    function updateWhitelist(address newWhiteAddress) external onlyOwner {
        emit WhiteAddressUpdated(whiteAddress, newWhiteAddress);
        whiteAddress = newWhiteAddress;
    }

    function exchange(uint256 amount) external {
        require(msg.sender == whiteAddress, "caller not in whitelist");

        btcb.safeTransferFrom(msg.sender, address(this), amount);
        sats.safeTransfer(msg.sender, amount);

        emit Exchanged(block.timestamp, amount, msg.sender);
    }

    function exchangeBack(uint256 amount) external {
        require(msg.sender == whiteAddress, "caller not in whitelist");

        sats.safeTransferFrom(msg.sender, address(this), amount);
        btcb.safeTransfer(msg.sender, amount);

        emit ExchangedBack(block.timestamp, amount, msg.sender);
    }
}
