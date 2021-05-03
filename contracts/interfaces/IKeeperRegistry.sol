// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IKeeperRegistry {
    function getCollateralValue(address keeper) external view returns (uint256);

    /*function importKeepers(
        address[] calldata assets,
        address[] calldata keepers,
        uint256[][] calldata keeperAmounts
    ) external;*/

    event AssetAdded(address indexed asset);

    event KeeperAdded(address indexed keeper, address asset, uint256 amount);
    event KeeperDeleted(address indexed keeper);
    event KeeperImported(
        address indexed from,
        address[] assets,
        address[] keepers,
        uint256[][] keeperAmounts
    );

    event TreasuryTransferred(address indexed previousTreasury, address indexed newTreasury);
    event Confiscated(address indexed treasury, address asset, uint256 amount);
}
