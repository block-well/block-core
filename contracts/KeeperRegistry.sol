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

    function getCollateralValue(address keeper) external view override returns (uint256) {
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

    // TODO: each keeper only have one non-zero asset
    /*function importKeepers(
        address[] calldata assets,
        address[] calldata keepers,
        uint256[][] calldata keeperAmounts
    ) external override {
        require(keeperAmounts.length == keepers.length, "amounts length does not match");
        require(keeperAmounts[0].length == assets.length, "amounts length does not match");

        // transfer
        for (uint256 i = 0; i < assets.length; i++) {
            require(assetSet.contains(assets[i]), "assets not accepted");
            uint256 sumAmounts = 0;
            for (uint256 j = 0; j < keepers.length; j++) {
                sumAmounts = sumAmounts.add(keeperAmounts[i][j]);
            }
            require(
                ERC20(assets[i]).transferFrom(msg.sender, address(this), sumAmounts),
                "transfer failed"
            );
        }

        // add keeper
        for (uint256 i = 0; i < keepers.length; i++) {
            _addKeeper(keepers[i], assets, keeperAmounts[i]);
        }

        emit KeeperImported(msg.sender, assets, keepers, keeperAmounts);
    }*/

    function punishKeeper(address keeper, uint256 overissuedAmount) external onlyOwner {
        address asset = perUserCollateral[keeper];
        require(assetSet.contains(asset), "nonexistent asset");
        uint256 collateral = collaterals[keeper][asset];

        if (asset == address(eBTC)) {
            uint256 deduction = overissuedAmount.min(collateral);
            eBTC.burn(deduction);
            overissuedAmount = overissuedAmount.sub(deduction);
            collateral = collateral.sub(deduction);
        }

        confiscations[asset] = confiscations[asset].add(collateral);
        overissuedTotal = overissuedTotal.add(overissuedAmount);

        delete collaterals[keeper][asset];
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        emit TreasuryTransferred(treasury, newTreasury);
        treasury = newTreasury;
    }

    function confiscate(address[] calldata assets) external {
        require(treasury != address(0), "treasury not up yet");

        for (uint256 i = 0; i < assets.length; i++) {
            require(
                IERC20(assets[i]).transfer(treasury, confiscations[assets[i]]),
                "transfer failed"
            );
            delete confiscations[assets[i]];
        }
    }

    function offsetOverissue(uint256 ebtcAmount) external {
        eBTC.burnFrom(msg.sender, ebtcAmount);
        overissuedTotal = overissuedTotal.sub(ebtcAmount);
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
