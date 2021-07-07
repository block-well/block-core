// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract SATS is AccessControl, ERC20Burnable, ERC20Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor() public ERC20("DeCus Satoshi", "SATS") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

        _setupDecimals(10);
    }

    function mint(address to, uint256 amount) public {
        require(hasRole(MINTER_ROLE, msg.sender), "require minter role");
        _mint(to, amount);
    }

    function pause() public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "require admin role");
        _pause();
    }

    function unpause() public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "require admin role");
        _unpause();
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Pausable) {
        super._beforeTokenTransfer(from, to, amount);
    }
}
