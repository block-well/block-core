// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

library BtcUtility {
    uint256 public constant ERC20_DECIMAL = 18;

    //    function getBTCDecimal() external pure returns (uint256) { return BTC_DECIMAL; }

    function getSatoshiMultiplierForEBTC() internal pure returns (uint256) {
        return 1e10;
    }

    function getSatoshiDivisor(uint256 decimal) internal pure returns (uint256) {
        require(ERC20_DECIMAL >= decimal, "asset decimal not supported");

        return 10**uint256(ERC20_DECIMAL - decimal);
    }
}
