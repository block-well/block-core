// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {EBTC} from "./EBTC.sol";
import {IKeeperRegistry} from "../interfaces/IKeeperRegistry.sol";
import {IBtcRater} from "../interfaces/IBtcRater.sol";
import {ILiquidation} from "../interfaces/ILiquidation.sol";
import {BtcUtility} from "../utils/BtcUtility.sol";

contract KeeperRegistry is
    Ownable,
    IKeeperRegistry,
    ERC20("DecuX CToken", "DCX-CT"),
    ReentrancyGuard
{
    using Math for uint256;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    address public system;
    EBTC public immutable ebtc;
    IBtcRater public immutable btcRater;
    ILiquidation public liquidation;

    EnumerableSet.AddressSet assetSet;
    uint256 public minKeeperCollateral;
    uint32 public MIN_KEEPER_PERIOD = 2592000; // 30 days
    uint8 public earlyExitFeeBps = 0;

    mapping(address => KeeperData) public keeperData;
    uint256 public overissuedTotal;
    mapping(address => uint256) public confiscations;

    modifier onlySystem() {
        require(system == _msgSender(), "require system role");
        _;
    }

    constructor(
        address[] memory _assets,
        EBTC _ebtc,
        IBtcRater _btcRater,
        uint256 _minKeeperCollateral
    ) {
        btcRater = _btcRater;
        minKeeperCollateral = _minKeeperCollateral;
        for (uint256 i = 0; i < _assets.length; i++) {
            _updateAsset(_assets[i], true);
        }
        ebtc = _ebtc;
    }

    function updateMinKeeperCollateral(uint256 amount) external onlyOwner {
        minKeeperCollateral = amount;
        emit MinCollateralUpdated(amount);
    }

    function setSystem(address _system) external onlyOwner {
        emit SystemUpdated(system, _system);
        system = _system;
    }

    function getCollateralWei(address keeper) external view override returns (uint256) {
        return keeperData[keeper].amount;
    }

    function isKeeperQualified(address keeper) external view override returns (bool) {
        return keeperData[keeper].amount >= minKeeperCollateral;
    }

    function getKeeper(address keeper) external view returns (KeeperData memory) {
        return keeperData[keeper];
    }

    function updateAsset(address asset, bool isAdd) external onlyOwner {
        _updateAsset(asset, isAdd);
    }

    function assetList() external view returns (address[] memory) {
        return assetSet.values();
    }

    function updateEarlyExitFeeBps(uint8 bps) external onlyOwner {
        earlyExitFeeBps = bps;
        emit EarlyExitFeeBpsUpdated(bps);
    }

    function swapAsset(address asset, uint256 amount) external nonReentrant {
        require(assetSet.contains(asset), "assets not accepted");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        KeeperData storage data = keeperData[msg.sender];
        require(data.asset != address(0), "keeper not exist");
        require(data.asset != asset, "same asset");

        uint256 normalizedAmount = btcRater.calcAmountInWei(asset, amount);
        require(normalizedAmount == data.amount, "cannot reduce amount");

        _refundKeeper(data, data.amount);

        data.asset = asset;
        data.amount = normalizedAmount;
        data.joinTimestamp = _blockTimestamp();

        emit KeeperAssetSwapped(msg.sender, asset, amount);
    }

    function addKeeper(address asset, uint256 amount) external {
        require(assetSet.contains(asset), "assets not accepted");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        address origAsset = keeperData[msg.sender].asset;
        require((origAsset == address(0)) || (origAsset == asset), "asset not allowed");

        _addKeeper(msg.sender, asset, btcRater.calcAmountInWei(asset, amount));
    }

    function deleteKeeper(uint256 cAmount) external nonReentrant {
        KeeperData storage data = keeperData[msg.sender];
        require(data.refCount == 0, "ref count > 0");

        _burn(msg.sender, cAmount);

        uint256 refundAmount = _refundKeeper(data, cAmount);

        emit KeeperDeleted(msg.sender, data.asset, refundAmount, cAmount);

        if (data.amount == 0) delete keeperData[msg.sender];
    }

    function punishKeeper(address[] calldata keepers) external onlyOwner {
        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            KeeperData storage data = keeperData[keeper];

            address asset = data.asset;
            uint256 amount = data.amount;
            confiscations[asset] = confiscations[asset].add(amount);
            data.amount = 0;
            emit KeeperPunished(keeper, asset, amount);
        }
    }

    function updateLiquidation(ILiquidation newLiquidation) external onlyOwner {
        emit LiquidationUpdated(address(liquidation), address(newLiquidation));
        liquidation = newLiquidation;
    }

    function confiscate(address[] calldata assets) external nonReentrant {
        require(liquidation != ILiquidation(address(0)), "liquidation not up yet");

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 confiscation = confiscations[assets[i]];
            uint256 amount = btcRater.calcOrigAmount(assets[i], confiscation);
            IERC20(assets[i]).approve(address(liquidation), amount);
            liquidation.receiveFund(IERC20(assets[i]), amount);
            emit Confiscated(address(liquidation), assets[i], confiscation);
            delete confiscations[assets[i]];
        }
    }

    function addConfiscation(address sender, address asset, uint256 amount) external override {
        require(liquidation != ILiquidation(address(0)), "caller contract not up yet");
        require(msg.sender == address(liquidation), "only liquidation can call");

        IERC20(asset).safeTransferFrom(sender, address(this), amount);
        uint256 normalizedAmount = btcRater.calcAmountInWei(asset, amount);
        confiscations[asset] = confiscations[asset].add(normalizedAmount);
        emit ConfiscationAdded(asset, normalizedAmount);
    }

    function addOverissue(uint256 overissuedAmount) external onlyOwner {
        require(overissuedAmount > 0, "zero overissued amount");
        overissuedTotal = overissuedTotal.add(overissuedAmount);
        emit OverissueAdded(overissuedTotal, overissuedAmount);
    }

    function offsetOverissue(uint256 ebtcAmount) external {
        overissuedTotal = overissuedTotal.sub(ebtcAmount);
        confiscations[address(ebtc)] = confiscations[address(ebtc)].sub(ebtcAmount);
        ebtc.burn(ebtcAmount);
        emit OffsetOverissued(msg.sender, ebtcAmount, overissuedTotal);
    }

    function incrementRefCount(address keeper) external override onlySystem {
        KeeperData storage data = keeperData[keeper];
        uint32 refCount = data.refCount + 1;
        require(refCount > data.refCount, "overflow"); // safe math
        data.refCount = refCount;
        emit KeeperRefCount(keeper, refCount);
    }

    function decrementRefCount(address keeper) external override onlySystem {
        KeeperData storage data = keeperData[keeper];
        require(data.refCount > 0); // safe math
        data.refCount = data.refCount - 1;
        emit KeeperRefCount(keeper, data.refCount);
    }

    function _updateAsset(address asset, bool isAdd) private {
        if (isAdd) {
            assetSet.add(asset);
        } else {
            assetSet.remove(asset);
        }
        emit AssetUpdate(asset, isAdd);
    }

    function _blockTimestamp() internal view virtual returns (uint32) {
        return uint32(block.timestamp);
    }

    function _addKeeper(address keeper, address asset, uint256 amount) private {
        KeeperData storage data = keeperData[keeper];
        data.asset = asset;
        data.amount = data.amount.add(amount);
        data.joinTimestamp = _blockTimestamp();
        require(data.amount >= minKeeperCollateral, "not enough collateral");

        _mint(keeper, amount);

        emit KeeperAdded(keeper, asset, amount);
    }

    function _refundKeeper(
        KeeperData storage data,
        uint256 cAmount
    ) private returns (uint256 amount) {
        data.amount = data.amount.sub(cAmount);
        amount = cAmount;
        address asset = data.asset;
        if ((earlyExitFeeBps > 0) && (_blockTimestamp() < data.joinTimestamp + MIN_KEEPER_PERIOD)) {
            amount = amount.mul(10000 - earlyExitFeeBps).div(10000);
        }
        IERC20(asset).safeTransfer(msg.sender, btcRater.calcOrigAmount(asset, amount));
    }
}
