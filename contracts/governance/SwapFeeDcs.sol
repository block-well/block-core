// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeDcs is ISwapFee, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    uint16 public mintFeeGasPrice; // in gwei
    uint32 public mintFeeGasUsed;
    uint256 public burnFeeDcs;
    IERC20 public dcs;
    address public system;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    //================================= Public =================================
    // function initialize(bytes calldata data) external initializer {
    function initialize() external initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();
        // address dcsAddr;
        // (mintFeeGasPrice, mintFeeGasUsed, burnFeeDcs, dcsAddr, system) = abi.decode(
        //     data,
        //     (uint16, uint32, uint256, address, address)
        // );
        // dcs = IERC20(dcsAddr);
    }

    function payMintEthFee() external payable override {
        require(msg.value >= getMintEthFee(), "not enough eth");
    }

    function payExtraMintFee(address, uint256) external pure override returns (uint256) {
        return 0;
    }

    function payExtraBurnFee(address from, uint256) external override returns (uint256) {
        require(msg.sender == system, "only system");
        dcs.safeTransferFrom(from, address(this), burnFeeDcs);
        return 0;
    }

    function collectDcs(uint256 amount) public onlyOwner {
        dcs.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(dcs), amount);
    }

    function collectEther(address payable to, uint256 amount) public onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }

    function getMintEthFee() public view override returns (uint256) {
        return 1e9 * uint256(mintFeeGasUsed) * uint256(mintFeeGasPrice);
    }

    function getMintFeeAmount(uint256) external pure override returns (uint256) {
        return 0;
    }

    function getBurnFeeAmount(uint256) public pure override returns (uint256) {
        return 0;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
