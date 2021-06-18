// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {CONG} from "./CONG.sol";
import {IKeeperRegistry} from "./interfaces/IKeeperRegistry.sol";
import {IBtcRater} from "./interfaces/IBtcRater.sol";
import {BtcUtility} from "./utils/BtcUtility.sol";

contract KeeperRegistry is Ownable, IKeeperRegistry {
    using Math for uint256;
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    CONG public cong;
    address public treasury;

    EnumerableSet.AddressSet assetSet;
    IBtcRater public btcRater;
    mapping(address => mapping(address => uint256)) public collaterals;
    mapping(address => address) public perUserCollateral;
    mapping(address => uint256) public keeperRefCount;

    uint256 public overissuedTotal;
    mapping(address => uint256) public confiscations;

    constructor(
        address[] memory _assets,
        address _cong,
        address _btcRater
    ) public {
        btcRater = IBtcRater(_btcRater);
        for (uint256 i = 0; i < _assets.length; i++) {
            _addAsset(_assets[i]);
        }
        cong = CONG(_cong);
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
        // TODO: apply commission fee
        require(keeperRefCount[keeper] == 0, "keeper refCount not zero");
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

    function punishKeeper(address[] calldata keepers) external onlyOwner {
        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            address asset = perUserCollateral[keeper];
            uint256 collateral = collaterals[keeper][asset];

            confiscations[asset] = confiscations[asset].add(collateral);
            delete collaterals[keeper][asset];

            emit KeeperPunished(keeper, asset, collateral);
        }
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

    function addOverissue(uint256 overissuedAmount) external onlyOwner {
        require(overissuedAmount > 0, "zero overissued amount");
        uint256 congConfiscation = confiscations[address(cong)];
        uint256 deduction = 0;
        if (congConfiscation > 0) {
            deduction = overissuedAmount.min(congConfiscation);
            cong.burn(deduction);
            overissuedAmount = overissuedAmount.sub(deduction);
            confiscations[address(cong)] = congConfiscation.sub(deduction);
        }
        overissuedTotal = overissuedTotal.add(overissuedAmount);
        emit OverissueAdded(overissuedTotal, overissuedAmount, deduction);
    }

    function offsetOverissue(uint256 congAmount) external {
        cong.burnFrom(msg.sender, congAmount);
        overissuedTotal = overissuedTotal.sub(congAmount);

        emit OffsetOverissued(msg.sender, congAmount, overissuedTotal);
    }

    function incrementRefCount(address keeper) external {
        keeperRefCount[keeper] = keeperRefCount[keeper].add(1);
        emit KeeperRefCount(keeper, keeperRefCount[keeper]);
    }

    function decrementRefCount(address keeper) external {
        keeperRefCount[keeper] = keeperRefCount[keeper].sub(1);
        emit KeeperRefCount(keeper, keeperRefCount[keeper]);
    }

    function getKeeperRefCount(address keeper) external view returns (uint256) {
        return keeperRefCount[keeper];
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
        collaterals[keeper][asset] = btcRater.calcAmountInWei(asset, amount);
        perUserCollateral[keeper] = asset;

        emit KeeperAdded(keeper, asset, amount);
    }
}
