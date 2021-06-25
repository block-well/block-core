// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

library BtcUtility {
    uint256 public constant ERC20_DECIMAL = 18;
    uint256 public constant SATOSHI_DECIMAL = 8;

    function getSatsAmountMultiplier() internal pure returns (uint256) {
        return 1e10;
    }

    function getWeiMultiplier(uint256 decimal) internal pure returns (uint256) {
        require(ERC20_DECIMAL >= decimal, "asset decimal not supported");

        // the result is strictly <= 10**18, no need to check overflow
        return 10**uint256(ERC20_DECIMAL - decimal);
    }

    function getSatoshiDivisor(uint256 decimal) internal pure returns (uint256) {
        require((SATOSHI_DECIMAL <= decimal) && (decimal <= 18), "asset decimal not supported");

        // the result is strictly <= 10**10, no need to check overflow
        return 10**uint256(decimal - SATOSHI_DECIMAL);
    }
}
