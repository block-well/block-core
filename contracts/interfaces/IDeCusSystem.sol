// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";

interface IDeCusSystem {
    struct Group {
        uint256 required;
        uint256 maxSatoshi;
        uint256 currSatoshi;
        uint256 nonce;
        EnumerableSet.AddressSet keeperSet;
    }

    struct GroupInfo {
        uint256 required;
        uint256 maxSatoshi;
        uint256 currSatoshi;
        uint256 nonce;
        address[] keepers;
        uint256 cooldown;
        bytes32 workingReceiptId;
        GroupStatus status;
    }

    enum GroupStatus {
        None,
        Available,
        MintRequested,
        MintVerified,
        MintTimeout,
        BurnRequested,
        BurnTimeout,
        MintGap
    }
    enum Status {Available, DepositRequested, DepositReceived, WithdrawRequested}

    struct Receipt {
        uint256 amountInSatoshi;
        uint256 updateTimestamp;
        bytes32 txId;
        uint256 height;
        Status status;
        address recipient;
        string groupBtcAddress;
        string withdrawBtcAddress;
    }

    struct BtcRefundData {
        uint256 expiryTimestamp;
        bytes32 txId;
        string groupBtcAddress;
    }

    struct MintRequest {
        bytes32 receiptId;
        bytes32 txId;
        uint256 height;
    }

    // events
    event GroupAdded(string btcAddress, uint256 required, uint256 maxSatoshi, address[] keepers);
    event GroupDeleted(string btcAddress);

    event MinKeeperWeiUpdated(uint256 amount);

    event MintRequested(
        bytes32 indexed receiptId,
        address indexed recipient,
        uint256 amountInSatoshi,
        string groupBtcAddress
    );
    event MintRevoked(bytes32 indexed receiptId, string groupBtcAddress, address operator);
    event MintVerified(bytes32 indexed receiptId, string groupBtcAddress, address[] keepers);
    event BurnRequested(
        bytes32 indexed receiptId,
        string groupBtcAddress,
        string withdrawBtcAddress,
        address operator
    );
    event BurnRevoked(bytes32 indexed receiptId, string groupBtcAddress, address operator);
    event BurnVerified(bytes32 indexed receiptId, string groupBtcAddress, address operator);

    event Cooldown(address indexed keeper, uint256 endTime);

    event BtcRefunded(string groupBtcAddress, bytes32 txId, uint256 expiryTimestamp);
}
