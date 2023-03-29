// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MockERC20 is ERC20Burnable {
    uint8 private immutable _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function mint(address account, uint256 amount) public {
        _mint(account, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}

contract MockWBTC is MockERC20 {
    constructor() MockERC20("Wrapped Bitcoin", "WBTC", 8) {}
}

contract MockBTCB is MockERC20 {
    constructor() MockERC20("BTCB Token", "BTCB", 18) {}
}
