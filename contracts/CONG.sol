// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CONG is AccessControl, ERC20Burnable, ERC20Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant BTC_MULTIPLIER = 1e8;

    constructor() public ERC20("DeCus Satoshi", "CONG") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

        _setupRole(PAUSER_ROLE, msg.sender);

        _setupDecimals(10);
    }

    function mint(address to, uint256 amount) public {
        require(hasRole(MINTER_ROLE, msg.sender), "require minter role");
        _mint(to, amount);
    }

    function pause() public {
        require(hasRole(PAUSER_ROLE, msg.sender), "require pauser role");
        _pause();
    }

    function unpause() public {
        require(hasRole(PAUSER_ROLE, msg.sender), "require pauser role");
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
