// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IToken} from "./interfaces/IToken.sol";
import {ISwapFee} from "./interfaces/ISwapFee.sol";

contract SwapFee is ISwapFee, Ownable {
    using SafeMath for uint256;

    uint8 private _mintFeeBps;
    uint8 private _burnFeeBps;
    IToken public immutable sats;

    event FeeCollected(address indexed to, address indexed asset, uint256 amount);

    //================================= Public =================================
    constructor(
        uint8 mintFeeBps,
        uint8 burnFeeBps,
        IToken _sats
    ) public {
        _mintFeeBps = mintFeeBps;
        _burnFeeBps = burnFeeBps;
        sats = _sats;
    }

    function getMintFeeBps() external view override returns (uint8) {
        return _mintFeeBps;
    }

    function getBurnFeeBps() external view override returns (uint8) {
        return _burnFeeBps;
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

    function payExtraMintFee(address, uint256 amount) external override returns (uint256) {
        // potentially to use dcs
        return amount.mul(_mintFeeBps).div(10000);
    }

    function payExtraBurnFee(address, uint256 amount) external override returns (uint256) {
        // potentially to use dcs
        return amount.mul(_burnFeeBps).div(10000);
    }

    function collectFee(uint256 amount) public onlyOwner {
        sats.transfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(sats), amount);
    }
}
