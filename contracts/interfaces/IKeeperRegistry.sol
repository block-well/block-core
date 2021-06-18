// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IKeeperRegistry {
    function getCollateralWei(address keeper) external view returns (uint256);

    function importKeepers(
        uint256 amount,
        address asset,
        address[] calldata keepers
    ) external;

    event AssetAdded(address indexed asset);

    event KeeperAdded(address indexed keeper, address asset, uint256 amount);
    event KeeperDeleted(address indexed keeper);
    event KeeperImported(address indexed from, address asset, address[] keepers, uint256 amount);

    event KeeperRefCount(address indexed keeper, uint256 count);
    event KeeperPunished(address indexed keeper, address asset, uint256 collateral);

    event TreasuryTransferred(address indexed previousTreasury, address indexed newTreasury);
    event Confiscated(address indexed treasury, address asset, uint256 amount);
    event OverissueAdded(uint256 total, uint256 added, uint256 deduction);
    event OffsetOverissued(
        address indexed operator,
        uint256 congAmount,
        uint256 remainingOverissueAmount
    );
}
