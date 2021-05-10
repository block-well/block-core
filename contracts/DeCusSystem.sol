// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import {IDeCusSystem} from "./interfaces/IDeCusSystem.sol";
import {IKeeperRegistry} from "./interfaces/IKeeperRegistry.sol";
import {IEBTC} from "./interfaces/IEBTC.sol";
import {LibRequest} from "./utils/LibRequest.sol";
import {BtcUtility} from "./utils/BtcUtility.sol";

contract DeCusSystem is Ownable, Pausable, IDeCusSystem, LibRequest {
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant KEEPER_COOLDOWN = 10 minutes;
    uint256 public constant WITHDRAW_VERIFICATION_START = 1 hours;
    uint256 public constant WITHDRAW_VERIFICATION_END = 1 days;
    uint256 public minKeeperSatoshi = 1e5;

    IEBTC public eBTC;
    IKeeperRegistry public keeperRegistry;

    mapping(string => Group) private groups; // btc address -> Group
    mapping(bytes32 => Receipt) private receipts; // receipt ID -> Receipt
    mapping(address => uint256) private cooldownUntil; // keeper address -> cooldown end timestamp

    function initialize(address _eBTC, address _registry) external {
        eBTC = IEBTC(_eBTC);
        keeperRegistry = IKeeperRegistry(_registry);
    }

    function getGroup(string calldata btcAddress)
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        Group storage group = groups[btcAddress];
        return (group.required, group.maxSatoshi, group.currSatoshi);
    }

    function listGroupKeeper(string calldata btcAddress) public view returns (address[] memory) {
        Group storage group = groups[btcAddress];

        address[] memory keeperArray = new address[](group.keeperSet.length());
        for (uint256 i = 0; i < group.keeperSet.length(); i++) {
            keeperArray[i] = group.keeperSet.at(i);
        }
        return keeperArray;
    }

    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }

    function getCooldownTime(address keeper) external view returns (uint256) {
        return cooldownUntil[keeper];
    }

    function getReceiptId(
        string memory btcAddress,
        address recipient,
        uint256 identifier
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(btcAddress, recipient, identifier));
    }

    function getGroupAllowance(string memory btcAddress) public view returns (uint256) {
        Group storage group = groups[btcAddress];
        return group.maxSatoshi.sub(group.currSatoshi);
    }

    function addGroup(
        string memory btcAddress,
        uint256 required,
        uint256 maxSatoshi,
        address[] calldata keepers
    ) external onlyOwner {
        Group storage group = groups[btcAddress];
        require(group.maxSatoshi == 0, "group id already exist");

        group.required = required;
        group.maxSatoshi = maxSatoshi;
        for (uint256 i = 0; i < keepers.length; i++) {
            require(
                keeperRegistry.getCollateralValue(keepers[i]) >= minKeeperSatoshi,
                "keepre has not enough collaterl"
            );
            group.keeperSet.add(keepers[i]);
        }

        emit GroupAdded(btcAddress, required, maxSatoshi, keepers);
    }

    function deleteGroup(string memory btcAddress) external onlyOwner {
        require(groups[btcAddress].currSatoshi == 0, "group balance is not empty");

        delete groups[btcAddress];

        emit GroupDeleted(btcAddress);
    }

    function requestMint(
        string memory btcAddress,
        uint256 amountInSatoshi,
        uint256 identifier
    ) public {
        require(amountInSatoshi > 0, "amount 0 is not allowed");
        require(getGroupAllowance(btcAddress) >= amountInSatoshi, "exceed group allowance");

        bytes32 receiptId = _requestDeposit(msg.sender, btcAddress, amountInSatoshi, identifier);

        emit MintRequested(btcAddress, receiptId, msg.sender, amountInSatoshi);
    }

    function verifyMint(
        LibRequest.MintRequest memory request,
        address[] calldata keepers, // keepers must be in ascending orders
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 packedV
    ) public {
        Receipt storage receipt = receipts[request.receiptId];
        Group storage group = groups[receipt.btcAddress];
        require(receipt.status == Status.DepositRequested, "receipt already verified");
        require(keepers.length >= group.required, "not enough keepers");

        _verifyDeposit(request, group.keeperSet, keepers, r, s, packedV);
        _approveDeposit(group, receipt, request.txId, request.height);
        _mintToUser(receipt);

        emit MintVerified(request.receiptId);
    }

    function requestBurn(bytes32 receiptId, string memory btcAddress) public {
        // TODO: add fee deduction
        Receipt storage receipt = receipts[receiptId];
        require(
            receipt.status == Status.DepositReceived,
            "receipt is not in DepositReceived state"
        );

        uint256 amount = receipt.amountInSatoshi.mul(BtcUtility.getSatoshiMultiplierForEBTC());
        eBTC.transferFrom(msg.sender, address(this), amount);

        receipt.withdrawTime = block.timestamp;
        receipt.btcAddress = btcAddress;
        receipt.status = Status.WithdrawRequested;

        emit BurnRequested(btcAddress, receiptId, msg.sender);
    }

    function verifyBurn(bytes32 receiptId) public {
        Receipt memory receipt = receipts[receiptId];
        require(
            receipt.status == Status.WithdrawRequested &&
                receipt.withdrawTime.add(WITHDRAW_VERIFICATION_START) < block.timestamp,
            "receipt is not in withdraw verification period"
        );
        groups[receipt.btcAddress].currSatoshi = groups[receipt.btcAddress].currSatoshi.sub(
            receipt.amountInSatoshi
        );

        uint256 amount = receipt.amountInSatoshi.mul(BtcUtility.getSatoshiMultiplierForEBTC());
        eBTC.burn(amount);

        delete receipts[receiptId];
    }

    //---------------------------- Arbitration ---------------------------------
    function chill(address keeper, uint256 chillTime) external onlyOwner {
        _cooldown(keeper, block.timestamp.add(chillTime));
    }

    function recoverBurn(bytes32 receiptId) external onlyOwner {
        Receipt memory receipt = receipts[receiptId];
        require(
            receipt.status == Status.WithdrawRequested,
            "receipt is not in withdraw requested status"
        );
        uint256 amount = receipt.amountInSatoshi.mul(BtcUtility.getSatoshiMultiplierForEBTC());
        eBTC.transfer(msg.sender, amount);

        receipt.status = Status.DepositReceived;
    }

    //------------------------------ Private -----------------------------------
    function _requestDeposit(
        address recipient,
        string memory btcAddress,
        uint256 amountInSatoshi,
        uint256 identifier
    ) private returns (bytes32) {
        bytes32 receiptId = getReceiptId(btcAddress, recipient, identifier);
        Receipt storage receipt = receipts[receiptId];
        if (receipt.status == Status.WithdrawRequested) {
            require(
                receipt.withdrawTime.add(WITHDRAW_VERIFICATION_END) < block.timestamp,
                "withdraw in progress"
            );
            uint256 amount = receipt.amountInSatoshi.mul(BtcUtility.getSatoshiMultiplierForEBTC());
            eBTC.burn(amount);

            receipt.txId = "";
            receipt.height = 0;
            receipt.withdrawTime = 0;
        } else {
            require(receipt.status == Status.Available, "receipt is in use");
        }

        receipt.recipient = recipient;
        receipt.btcAddress = btcAddress;
        receipt.amountInSatoshi = amountInSatoshi;
        receipt.status = Status.DepositRequested;
        receipt.createTimestamp = block.timestamp;

        return receiptId;
    }

    function _verifyDeposit(
        LibRequest.MintRequest memory request,
        EnumerableSet.AddressSet storage keeperSet,
        address[] calldata keepers,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 packedV
    ) private {
        uint256 cooldownTime = block.timestamp.add(KEEPER_COOLDOWN);
        bytes32 requestHash = getMintRequestHash(request);

        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            require(cooldownUntil[keeper] <= block.timestamp, "keeper is in cooldown");
            require(keeperSet.contains(keeper), "keeper is not in group");
            require(
                ecrecover(requestHash, uint8(packedV), r[i], s[i]) == keeper,
                "invalid signature"
            );

            _cooldown(keeper, cooldownTime);
            packedV >>= 8;
        }
    }

    function _approveDeposit(
        Group storage group,
        Receipt storage receipt,
        bytes32 txId,
        uint256 height
    ) private {
        receipt.status = Status.DepositReceived;
        receipt.txId = txId;
        receipt.height = height;

        uint256 currSatoshi = group.currSatoshi.add(receipt.amountInSatoshi);
        require(currSatoshi <= group.maxSatoshi, "amount exceed max allowance");
        group.currSatoshi = currSatoshi;
    }

    function _mintToUser(Receipt storage receipt) private {
        // TODO: add fee deduction
        eBTC.mint(
            receipt.recipient,
            receipt.amountInSatoshi.mul(BtcUtility.getSatoshiMultiplierForEBTC())
        );
    }

    function _cooldown(address keeper, uint256 cooldownEnd) private {
        cooldownUntil[keeper] = cooldownEnd;
        emit Cooldown(keeper, cooldownEnd);
    }
}
