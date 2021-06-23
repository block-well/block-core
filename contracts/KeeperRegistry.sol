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
    using SafeMath for uint32;
    using EnumerableSet for EnumerableSet.AddressSet;

    CONG public cong;
    address public treasury;
    address public system;

    EnumerableSet.AddressSet assetSet;
    IBtcRater public btcRater;
    uint32 public MIN_KEEPER_PERIOD = 15552000 ; // 6 month
    uint8 public earlyExitFeeBps = 100;

    mapping(address => KeeperData) public keeperData;
    uint256 public overissuedTotal;
    mapping(address => uint256) public confiscations;

    modifier onlySystem() {
        require(system == _msgSender(), "require system role");
        _;
    }

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

    function setSystem(address _system) external onlyOwner {
        emit SystemUpdated(system, _system);
        system = _system;
    }

    function getCollateralWei(address keeper) external view override returns (uint256) {
        return keeperData[keeper].amount;
    }

    function getKeeper(address keeper) external view returns (KeeperData memory) {
        return keeperData[keeper];
    }

    function addAsset(address asset) external onlyOwner {
        _addAsset(asset);
    }

    function updateEarlyExitFeeBps(uint8 bps) external onlyOwner {
        earlyExitFeeBps = bps;
        emit EarlyExitFeeBpsUpdated(bps);
    }

    function addKeeper(address asset, uint256 amount) external {
        require(assetSet.contains(asset), "assets not accepted");
        require(keeperData[msg.sender].asset == address(0), "keeper already exist");
        require(IERC20(asset).transferFrom(msg.sender, address(this), amount), "transfer failed");

        _addKeeper(msg.sender, asset, btcRater.calcAmountInWei(asset, amount));
    }

    function deleteKeeper() external {
        KeeperData storage data = keeperData[msg.sender];
        require(data.refCount == 0, "ref count > 0");

        uint256 amount = data.amount;
        if (block.timestamp < data.joinTimestamp.add(MIN_KEEPER_PERIOD)) {
            amount = amount.mul(10000 - earlyExitFeeBps).div(10000);
        }
        address asset = data.asset;
        require(
            IERC20(asset).transfer(msg.sender, btcRater.calcOrigAmount(data.asset, amount)),
            "transfer failed"
        );
        delete keeperData[msg.sender];

        emit KeeperDeleted(msg.sender, asset, amount);
    }

    function importKeepers(
        uint256 amount,
        address asset,
        address[] calldata keepers
    ) external override {
        require(assetSet.contains(asset), "unknown asset");
        require(amount > 0, "amount != 0");

        uint256 totalAmount;
        uint256 normalizedAmount = btcRater.calcAmountInWei(asset, amount);
        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            if (keeper != address(0)) {
                _addKeeper(keeper, asset, normalizedAmount);
                totalAmount = totalAmount.add(amount);
            }
        }

        require(IERC20(asset).transferFrom(msg.sender, address(this), totalAmount));

        emit KeeperImported(msg.sender, asset, keepers, normalizedAmount);
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

    function incrementRefCount(address keeper) external override onlySystem {
        KeeperData storage data = keeperData[keeper];
        require(data.refCount + 1 > data.refCount); // safe math
        data.refCount = data.refCount + 1;
        emit KeeperRefCount(keeper, data.refCount);
    }

    function decrementRefCount(address keeper) external override onlySystem {
        KeeperData storage data = keeperData[keeper];
        require(data.refCount > 0); // safe math
        data.refCount = data.refCount - 1;
        emit KeeperRefCount(keeper, data.refCount);
    }

    function _addAsset(address asset) private {
        assetSet.add(asset);
        emit AssetAdded(asset);
    }

    function _blockTimestamp() internal view virtual returns (uint32) {
        return uint32(block.timestamp); 
    }

    function _addKeeper(
        address keeper,
        address asset,
        uint256 amount
    ) private {
        KeeperData storage data = keeperData[keeper];
        data.asset = asset;
        data.amount = amount;
        data.joinTimestamp = _blockTimestamp();

        emit KeeperAdded(keeper, asset, amount); }
}
