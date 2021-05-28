// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {IKeeperRegistry} from "./interfaces/IKeeperRegistry.sol";
import {IEBTC} from "./interfaces/IEBTC.sol";
import {BtcUtility} from "./utils/BtcUtility.sol";

interface IERC20Extension {
    function decimals() external returns (uint8);
}

contract KeeperRegistry is Ownable, IKeeperRegistry {
    using Math for uint256;
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    IEBTC public eBTC;
    address public treasury;

    EnumerableSet.AddressSet assetSet;
    mapping(address => mapping(address => uint256)) public collaterals;
    mapping(address => address) public perUserCollateral;

    uint256 public overissuedTotal;
    mapping(address => uint256) public confiscations;

    constructor(address[] memory _assets, address _eBTC) public {
        for (uint256 i = 0; i < _assets.length; i++) {
            _addAsset(_assets[i]);
        }
        eBTC = IEBTC(_eBTC);
    }

    function getCollateralWei(address keeper) external view override returns (uint256) {
        return collaterals[keeper][perUserCollateral[keeper]];
    }

    function addAsset(address asset) external onlyOwner {
        _addAsset(asset);
    }

    function addKeeper(address asset, uint256 amount) external {
        // transfer assets
        require(assetSet.contains(asset), "assets not accepted");
        require(perUserCollateral[msg.sender] == address(0), "keeper already exist");
        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "transfer failed");

        _addKeeper(msg.sender, asset, amount);
    }

    function deleteKeeper(address keeper) external onlyOwner {
        // require admin role because we need to make sure keeper is not in any working groups
        address asset = perUserCollateral[keeper];
        require(IERC20(asset).approve(keeper, collaterals[keeper][asset]), "approve failed");
        delete collaterals[keeper][asset];
        delete perUserCollateral[keeper];

        emit KeeperDeleted(keeper);
    }

    function importKeepers(
        uint256 amount,
        address asset,
        address[] calldata keepers
    ) external override {
        require(assetSet.contains(asset), "unknown asset");
        require(amount > 0, "amount != 0");

        uint256 totalAmount;
        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            if (keeper != address(0)) {
                _addKeeper(keeper, asset, amount);
                totalAmount = totalAmount.add(amount);
            }
        }

        require(IERC20(asset).transferFrom(msg.sender, address(this), totalAmount));

        emit KeeperImported(msg.sender, asset, keepers, amount);
    }

    function punishKeeper(address[] calldata keepers, uint256 overissuedAmount) external onlyOwner {
        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            address asset = perUserCollateral[keeper];
            uint256 collateral = collaterals[keeper][asset];

            if (asset == address(eBTC)) {
                uint256 deduction = overissuedAmount.min(collateral);
                eBTC.burn(deduction);
                overissuedAmount = overissuedAmount.sub(deduction);
                collateral = collateral.sub(deduction);
            }

            confiscations[asset] = confiscations[asset].add(collateral);
            delete collaterals[keeper][asset];
        }

        overissuedTotal = overissuedTotal.add(overissuedAmount);
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        emit TreasuryTransferred(treasury, newTreasury);
        treasury = newTreasury;
    }

    function confiscate(address[] calldata assets) external {
        require(treasury != address(0), "treasury not up yet");

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 confiscation = confiscations[assets[i]];
            require(IERC20(assets[i]).transfer(treasury, confiscation), "transfer failed");
            emit Confiscated(treasury, assets[i], confiscation);
            delete confiscations[assets[i]];
        }
    }

    function offsetOverissue(uint256 ebtcAmount) external {
        eBTC.burnFrom(msg.sender, ebtcAmount);
        overissuedTotal = overissuedTotal.sub(ebtcAmount);

        emit OffsetOverissued(msg.sender, ebtcAmount, overissuedTotal);
    }

    function _addAsset(address asset) private {
        assetSet.add(asset);
        emit AssetAdded(asset);
    }

    function _addKeeper(
        address keeper,
        address asset,
        uint256 amount
    ) private {
        uint256 divisor = BtcUtility.getSatoshiDivisor(IERC20Extension(asset).decimals());
        collaterals[keeper][asset] = amount.mul(divisor);
        perUserCollateral[keeper] = asset;

        emit KeeperAdded(keeper, asset, amount);
    }
}
