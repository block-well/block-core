// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";

interface IDeCusSystem {
    struct Group {
        uint256 required;
        uint256 maxSatoshi;
        uint256 currSatoshi;
        bytes32 workingReceiptId;
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
        string groupBtcAddress;
        string withdrawBtcAddress;
        uint256 withdrawTimestamp;
    }

    // events
    event GroupAdded(
        string indexed btcAddress,
        uint256 required,
        uint256 maxSatoshi,
        address[] keepers
    );
    event GroupDeleted(string indexed btcAddress);

    event MintRequested(
        bytes32 indexed receiptId,
        string indexed groupBtcAddress,
        address indexed recipient,
        uint256 amountInSatoshi
    );
    event MintRevoked(bytes32 indexed receiptId, address operator);
    event MintVerified(bytes32 indexed receiptId, address[] keepers);
    event BurnRequested(bytes32 indexed receiptId, string withdrawBtcAddress, address operator);
    event BurnRevoked(bytes32 indexed receiptId, address operator);
    event BurnVerified(bytes32 indexed receiptId, address operator);

    event Cooldown(address indexed keeper, uint256 endTime);
}
