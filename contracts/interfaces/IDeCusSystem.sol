// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

interface IDeCusSystem {
    struct Group {
        uint256 required;
        uint256 maxSatoshi;
        uint256 currSatoshi;
        EnumerableSet.AddressSet keeperSet;
    }

    enum Status {Available, DepositRequested, DepositReceived, WithdrawRequested}

    struct Receipt {
        uint256 amountInSatoshi;
        uint256 createTimestamp;
        bytes32 txId;
        uint256 height;
        Status status;
        address recipient;
        string btcAddress; // for withdraw
        uint256 withdrawTime;
    }

    // events
    event GroupAdded(string btcAddress, uint256 required, uint256 maxSatoshi, address[] keepers);
    event GroupDeleted(string btcAddress);

    event MintRequested(
        string btcAddress,
        bytes32 receiptId,
        address sender,
        uint256 amountInSatoshi
    );
    event MintVerified(bytes32 indexed receiptId);

    event BurnRequested(string btcAddress, bytes32 receiptId, address sender);

    event Cooldown(address indexed keeper, uint256 endTime);
}
