// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IKeeperRegistry {
    struct KeeperData {
        uint256 amount;
        address asset;
        uint32 refCount;
        uint32 joinTimestamp;
    }

    function getCollateralWei(address keeper) external view returns (uint256);

    function isKeeperQualified(address keeper) external view returns (bool);

    function assetList() external view returns (address[] memory);

    function addConfiscation(address sender, address asset, uint256 amount) external;

    function incrementRefCount(address keeper) external;

    function decrementRefCount(address keeper) external;

    event MinCollateralUpdated(uint256 amount);

    event SystemUpdated(address oldSystem, address newSystem);
    event AssetUpdate(address indexed asset, bool isAdd);

    event KeeperAdded(address indexed keeper, address asset, uint256 amount);
    event KeeperDeleted(address indexed keeper, address asset, uint256 amount, uint256 cAmount);
    event KeeperImported(address indexed from, address asset, address[] keepers, uint256 amount);
    event KeeperAssetSwapped(address indexed keeper, address asset, uint256 amount);

    event KeeperRefCount(address indexed keeper, uint256 count);
    event KeeperPunished(address indexed keeper, address asset, uint256 collateral);

    event EarlyExitFeeBpsUpdated(uint8 bps);

    event LiquidationUpdated(address indexed previousLiquidation, address indexed newLiquidation);
    event Confiscated(address indexed liquidation, address asset, uint256 amount);
    event ConfiscationAdded(address asset, uint256 amount);
    event OverissueAdded(uint256 total, uint256 added);
    event OffsetOverissued(
        address indexed operator,
        uint256 ebtcAmount,
        uint256 remainingOverissueAmount
    );
}
