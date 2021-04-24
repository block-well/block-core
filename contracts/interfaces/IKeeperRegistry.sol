// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IKeeperRegistry {
    struct Asset {
        uint256 divisor; // 10 ** decimal
    }

    function getSatoshiValue(address keeper) external view returns (uint256);

    function importKeepers(
        address[] calldata assets,
        address[] calldata keepers,
        uint256[][] calldata keeperAmounts
    ) external;

    event AssetAdded(address indexed asset, uint256 divisor);

    event KeeperAdded(address indexed keeper, address[] assets, uint256[] amounts);
    event KeeperDeleted(address indexed keeper);
    event KeeperImported(
        address indexed from,
        address[] assets,
        address[] keepers,
        uint256[][] keeperAmounts
    );
}
