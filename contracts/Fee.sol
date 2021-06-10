// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {IFee} from "./interfaces/IFee.sol";

contract Fee is IFee, Ownable {
    uint8 private _mintFeeBps;
    uint8 private _burnFeeBps;

    //================================= Public =================================
    constructor(uint8 mintFeeBps, uint8 burnFeeBps) public {
        _mintFeeBps = mintFeeBps;
        _burnFeeBps = burnFeeBps;
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
}
