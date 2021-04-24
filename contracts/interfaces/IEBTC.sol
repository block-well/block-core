// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IEBTC {
    function mint(address to, uint256 amount) external;

    function burnFrom(address to, uint256 amount) external;
}
