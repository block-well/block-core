// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {ERC20, ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

contract DCX is ERC20Burnable, ERC20Permit {
    constructor(uint256 totalSupply, address owner) ERC20("DecuX", "DCX") ERC20Permit("DecuX") {
        _mint(owner, totalSupply);
    }
}
