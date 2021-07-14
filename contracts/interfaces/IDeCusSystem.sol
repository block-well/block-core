// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";

interface IDeCusSystem {
    struct Group {
        uint32 maxSatoshi;
        uint32 currSatoshi;
        uint32 nonce;
        uint32 required;
        EnumerableSet.AddressSet keeperSet;
    }

    enum Status {
        Available,
        DepositRequested,
        DepositReceived,
        WithdrawRequested
    }

    struct Receipt {
        string groupBtcAddress;
        string withdrawBtcAddress;
        bytes32 txId;
        uint32 amountInSatoshi;
        uint32 updateTimestamp;
        uint32 height;
        address recipient;
        Status status;
    }

    struct BtcRefundData {
        bytes32 txId;
        string groupBtcAddress;
        uint32 expiryTimestamp;
    }

    struct MintRequest {
        bytes32 receiptId;
        bytes32 txId;
        uint32 height;
    }

    // events
    event GroupAdded(string btcAddress, uint32 required, uint32 maxSatoshi, address[] keepers);
    event GroupDeleted(string btcAddress);

    event MintRequested(
        bytes32 indexed receiptId,
        address indexed recipient,
        uint32 amountInSatoshi,
        string groupBtcAddress
    );
    event MintRevoked(bytes32 indexed receiptId, string groupBtcAddress, address operator);
    event MintVerified(
        bytes32 indexed receiptId,
        string groupBtcAddress,
        address[] keepers,
        bytes32 btcTxId,
        uint32 btcTxHeight
    );
    event BurnRequested(
        bytes32 indexed receiptId,
        string groupBtcAddress,
        string withdrawBtcAddress,
        address operator
    );
    event BurnRevoked(
        bytes32 indexed receiptId,
        string groupBtcAddress,
        address recipient,
        address operator
    );
    event BurnVerified(bytes32 indexed receiptId, string groupBtcAddress, address operator);

    event Cooldown(address indexed keeper, uint32 endTime);

    event BtcRefunded(string groupBtcAddress, bytes32 txId, uint32 expiryTimestamp);
}
