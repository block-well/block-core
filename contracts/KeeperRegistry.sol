// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import {IKeeperRegistry} from "./interfaces/IKeeperRegistry.sol";
import {IEBTC} from "./interfaces/IEBTC.sol";
import {BtcUtility} from "./utils/BtcUtility.sol";

contract KeeperRegistry is Ownable, IKeeperRegistry {
    using Math for uint256;
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Uniswap
    IUniswapV2Router02 public uniswapRouter;

    IEBTC public eBTC;
    EnumerableSet.AddressSet assetSet;
    mapping(address => Asset) public metadata;
    mapping(address => mapping(address => uint256)) public collaterals;
    mapping(address => uint256) public totalCollaterals;

    constructor(
        address[] memory _assets,
        address _eBTC,
        address _uniswapRouter
    ) public {
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 decimal = ERC20(_assets[i]).decimals();
            _addAsset(_assets[i], decimal);
        }
        eBTC = IEBTC(_eBTC);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
    }

    function getSatoshiValue(address keeper) external view override returns (uint256) {
        return totalCollaterals[keeper];
    }

    function addAsset(address asset) external onlyOwner {
        uint256 decimal = ERC20(asset).decimals();
        _addAsset(asset, decimal);
    }

    function addKeeper(address[] calldata assets, uint256[] calldata amounts) external {
        // transfer assets
        for (uint256 i = 0; i < assets.length; i++) {
            require(assetSet.contains(assets[i]), "assets not accepted");
            require(
                ERC20(assets[i]).transferFrom(msg.sender, address(this), amounts[i]),
                "transfer failed"
            );
        }

        _addKeeper(msg.sender, assets, amounts);
    }

    function deleteKeeper(address keeper) external onlyOwner {
        // require admin role because we need to make sure keeper is not in any working groups
        for (uint256 i = 0; i < assetSet.length(); i++) {
            address asset = assetSet.at(i);
            require(ERC20(asset).approve(keeper, collaterals[keeper][asset]), "approve failed");
            delete collaterals[keeper][asset];
        }

        delete totalCollaterals[keeper];

        emit KeeperDeleted(keeper);
    }

    function importKeepers(
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
    }

    function punishKeeper(
        address[] calldata assets,
        address keeper,
        uint256 amount
    ) external onlyOwner {
        for (uint256 i = 0; i < assets.length && amount > 0; i++) {
            address asset = assets[i];
            require(assetSet.contains(asset), "nonexistent asset");
            uint256 collateral = collaterals[keeper][asset];

            if (asset == address(eBTC)) {
                uint256 deduction = amount.min(collateral);
                eBTC.burn(deduction);
                collaterals[keeper][asset] = collateral - deduction;
                amount = amount - deduction;
            } else {
                uint256 divisor = metadata[asset].divisor;
                uint256[] memory swapResult = _buyback(asset, amount, collateral.div(divisor));
                eBTC.burn(swapResult[1]);
                collaterals[keeper][asset] = collateral.sub(swapResult[0].mul(divisor));
                amount = amount.sub(swapResult[1]);
            }
        }
    }

    function _addAsset(address asset, uint256 decimal) private {
        assetSet.add(asset);
        uint256 divisor = BtcUtility.getSatoshiDivisor(decimal);
        metadata[asset].divisor = divisor;

        emit AssetAdded(asset, divisor);
    }

    function _addKeeper(
        address keeper,
        address[] calldata assets,
        uint256[] calldata amounts
    ) private {
        uint256 totalCollateral = totalCollaterals[keeper];
        require(totalCollateral == 0, "keeper existed");

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 divisor = metadata[assets[i]].divisor;
            uint256 amount = amounts[i].mul(divisor);
            totalCollateral = totalCollateral.add(amount);
            collaterals[keeper][assets[i]] = collaterals[keeper][assets[i]].add(amount);
        }
        totalCollaterals[keeper] = totalCollateral;

        emit KeeperAdded(keeper, assets, amounts);
    }

    function _buyback(
        address asset,
        uint256 amountOut,
        uint256 amountInMax
    ) internal returns (uint256[] memory) {
        if (IERC20(asset).allowance(address(this), address(uniswapRouter)) < amountInMax) {
            IERC20(asset).approve(address(uniswapRouter), type(uint256).max);
        }

        address[] memory path = new address[](2);
        path[0] = asset;
        path[1] = address(eBTC);
        uint256[] memory swapResult =
            uniswapRouter.swapTokensForExactTokens(
                amountOut,
                amountInMax,
                path,
                address(this),
                type(uint256).max
            );
        return swapResult;
    }
}
