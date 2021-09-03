// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract MockERC20 is ERC20Burnable {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) ERC20(name, symbol) {
        _setupDecimals(decimals);
    }

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }
}

contract MockWBTC is MockERC20 {
    constructor() MockERC20("Wrapped Bitcoin", "WBTC", 8) {}
}

contract MockBTCB is MockERC20 {
    constructor() MockERC20("BTCB Token", "BTCB", 18) {}
}
