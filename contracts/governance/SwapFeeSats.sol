// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapFee} from "../interfaces/ISwapFee.sol";

contract SwapFeeSats is ISwapFee, OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    uint16 public mintFeeGasPrice; // in gwei
    uint32 public mintFeeGasUsed;
    uint256 public burnFeeDcs;
    IERC20 public sats;
    address public system;
    uint8 public mintFeeBps;
    uint8 public burnFeeBps;

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

    function payExtraMintFee(address, uint256 amount) external view override returns (uint256) {
        return (amount * mintFeeBps) / 10000;
    }

    function payExtraBurnFee(address, uint256 amount) external view override returns (uint256) {
        return (amount * burnFeeBps) / 10000;
    }

    function collectSats(uint256 amount) public onlyOwner {
        sats.safeTransfer(msg.sender, amount);
        emit FeeCollected(msg.sender, address(sats), amount);
    }

    function collectEther(address payable to, uint256 amount) public onlyOwner {
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "failed to send ether");
        emit FeeCollected(to, address(0), amount);
    }

    function setNewValues(uint8 _mintFeeBps, uint8 _burnFeeBps, address _newSats) public onlyOwner {
        mintFeeBps = _mintFeeBps;
        burnFeeBps = _burnFeeBps;
        sats = IERC20(_newSats);
    }

    function getMintEthFee() public view override returns (uint256) {
        return 1e9 * uint256(mintFeeGasUsed) * uint256(mintFeeGasPrice);
    }

    function getMintFeeAmount(uint256 amount) external view override returns (uint256) {
        return (amount * uint256(mintFeeBps)) / 10000;
    }

    function getBurnFeeAmount(uint256 amount) public view override returns (uint256) {
        return (amount * uint256(burnFeeBps)) / 10000;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
