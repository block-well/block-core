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
    // uint256 public constant WITHDRAW_VERIFICATION_START = 1 hours;
    uint256 public constant WITHDRAW_VERIFICATION_END = 1 hours; // TODO: change to 1/2 days for production
    uint256 public constant MINT_REQUEST_GRACE_PERIOD = 1 hours; // TODO: change to 8 hours for production
    uint256 public minKeeperSatoshi = 1e5;

    IEBTC public eBTC;
    IKeeperRegistry public keeperRegistry;

    mapping(string => Group) private groups; // btc address -> Group
    mapping(bytes32 => Receipt) private receipts; // receipt ID -> Receipt
    mapping(address => uint256) private cooldownUntil; // keeper address -> cooldown end timestamp

    //================================= Public =================================
    function initialize(address _eBTC, address _registry) external {
        eBTC = IEBTC(_eBTC);
        keeperRegistry = IKeeperRegistry(_registry);
    }

    // ------------------------------ keeper -----------------------------------
    function chill(address keeper, uint256 chillTime) external onlyOwner {
        _cooldown(keeper, (block.timestamp).add(chillTime));
    }

    function getCooldownTime(address keeper) external view returns (uint256) {
        return cooldownUntil[keeper];
    }

    // -------------------------------- group ----------------------------------
    function getGroup(string calldata btcAddress)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            bytes32
        )
    {
        Group storage group = groups[btcAddress];
        return (group.required, group.maxSatoshi, group.currSatoshi, group.workingReceiptId);
    }

    function getGroupAllowance(string calldata btcAddress) external view returns (uint256) {
        Group storage group = groups[btcAddress];
        return (group.maxSatoshi).sub(group.currSatoshi);
    }

    function listGroupKeeper(string calldata btcAddress) external view returns (address[] memory) {
        Group storage group = groups[btcAddress];

        address[] memory keeperArray = new address[](group.keeperSet.length());
        for (uint256 i = 0; i < group.keeperSet.length(); i++) {
            keeperArray[i] = group.keeperSet.at(i);
        }
        return keeperArray;
    }

    function addGroup(
        string calldata btcAddress,
        uint256 required,
        uint256 maxSatoshi,
        address[] calldata keepers
    ) external onlyOwner {
        Group storage group = groups[btcAddress];
        require(group.maxSatoshi == 0, "group id already exist");

        group.required = required;
        group.maxSatoshi = maxSatoshi;
        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            require(
                keeperRegistry.getCollateralValue(keeper) >= minKeeperSatoshi,
                "keeper has not enough collateral"
            );
            group.keeperSet.add(keeper);
        }

        emit GroupAdded(btcAddress, required, maxSatoshi, keepers);
    }

    function deleteGroup(string calldata btcAddress) external onlyOwner {
        require(groups[btcAddress].currSatoshi == 0, "group balance is not empty");

        delete groups[btcAddress];

        emit GroupDeleted(btcAddress);
    }

    // ------------------------------- receipt ---------------------------------
    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }

    function getReceiptId(
        string calldata groupBtcAddress,
        address recipient,
        uint256 identifier
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(groupBtcAddress, recipient, identifier));
    }

    function requestMint(
        string calldata groupBtcAddress,
        uint256 amountInSatoshi,
        uint256 identifier
    ) public {
        require(amountInSatoshi > 0, "amount 0 is not allowed");

        Group storage group = groups[groupBtcAddress];
        require(group.workingReceiptId == 0, "working receipt in progress");
        require(
            (group.maxSatoshi).sub(group.currSatoshi) == amountInSatoshi,
            "should fill all group allowance"
        );

        address recipient = msg.sender;
        bytes32 receiptId = getReceiptId(groupBtcAddress, recipient, identifier);
        Receipt storage receipt = receipts[receiptId];
        _requestDeposit(receipt, groupBtcAddress, recipient, amountInSatoshi);

        group.workingReceiptId = receiptId;

        emit MintRequested(receiptId, recipient, amountInSatoshi, groupBtcAddress);
    }

    function revokeMint(bytes32 receiptId) public {
        Receipt storage receipt = receipts[receiptId];
        require(receipt.recipient == msg.sender, "require receipt recipient");

        _revokeMint(receiptId);
    }

    function _revokeMint(bytes32 receiptId) private {
        Receipt storage receipt = receipts[receiptId];
        _revokeDeposit(receipt);

        Group storage group = groups[receipt.groupBtcAddress];
        delete group.workingReceiptId;

        emit MintRevoked(receiptId, msg.sender);
    }

    function forceRequestMint(
        string calldata groupBtcAddress,
        uint256 amountInSatoshi,
        uint256 identifier
    ) public {
        Group storage group = groups[groupBtcAddress];
        Receipt storage receipt = receipts[group.workingReceiptId];

        if (receipt.status == Status.WithdrawRequested) {
            require(
                (receipt.withdrawTimestamp).add(WITHDRAW_VERIFICATION_END) < block.timestamp,
                "withdraw in progress"
            );
            verifyBurn(group.workingReceiptId);
        } else if (receipt.status == Status.DepositRequested) {
            require(
                (receipt.createTimestamp).add(MINT_REQUEST_GRACE_PERIOD) < block.timestamp,
                "deposit in progress"
            );
            _revokeMint(group.workingReceiptId);
        }

        requestMint(groupBtcAddress, amountInSatoshi, identifier);
    }

    function verifyMint(
        LibRequest.MintRequest calldata request,
        address[] calldata keepers, // keepers must be in ascending orders
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 packedV
    ) public {
        Receipt storage receipt = receipts[request.receiptId];
        Group storage group = groups[receipt.groupBtcAddress];
        _subGroupAllowance(group, receipt.amountInSatoshi);

        _verifyMintRequest(group, request, keepers, r, s, packedV);
        _approveDeposit(receipt, request.txId, request.height);

        _mintEBTC(receipt.recipient, receipt.amountInSatoshi);

        delete group.workingReceiptId;

        emit MintVerified(request.receiptId, keepers);
    }

    function requestBurn(bytes32 receiptId, string calldata withdrawBtcAddress) public {
        // TODO: add fee deduction
        Receipt storage receipt = receipts[receiptId];
        Group storage group = groups[receipt.groupBtcAddress];
        require(group.workingReceiptId == 0, "working receipt in progress");

        _requestWithdraw(receipt, withdrawBtcAddress);

        _transferFromEBTC(msg.sender, address(this), receipt.amountInSatoshi);

        group.workingReceiptId = receiptId;

        emit BurnRequested(receiptId, withdrawBtcAddress, msg.sender);
    }

    function verifyBurn(bytes32 receiptId) public {
        // TODO: allow only user or keepers to verify? If someone verified wrongly, we can punish
        Receipt storage receipt = receipts[receiptId];
        _approveWithdraw(receipt);

        _burnEBTC(receipt.amountInSatoshi);

        Group storage group = groups[receipt.groupBtcAddress];
        _addGroupAllowance(group, receipt.amountInSatoshi);

        delete group.workingReceiptId;

        delete receipts[receiptId];
        emit BurnVerified(receiptId, msg.sender);
    }

    function recoverBurn(bytes32 receiptId) public onlyOwner {
        Receipt storage receipt = receipts[receiptId];
        _revokeWithdraw(receipt);

        _transferEBTC(msg.sender, receipt.amountInSatoshi);

        Group storage group = groups[receipt.groupBtcAddress];
        delete group.workingReceiptId;

        emit BurnRevoked(receiptId, msg.sender);
    }

    //=============================== Private ==================================
    // ------------------------------ keeper -----------------------------------
    function _cooldown(address keeper, uint256 cooldownEnd) private {
        cooldownUntil[keeper] = cooldownEnd;
        emit Cooldown(keeper, cooldownEnd);
    }

    // -------------------------------- group ----------------------------------
    function _subGroupAllowance(Group storage group, uint256 amountInSatoshi) private {
        group.currSatoshi = (group.currSatoshi).add(amountInSatoshi);
        require(group.currSatoshi <= group.maxSatoshi, "amount exceed max allowance");
    }

    function _addGroupAllowance(Group storage group, uint256 amountInSatoshi) private {
        require(group.currSatoshi >= amountInSatoshi, "amount exceed min allowance");
        group.currSatoshi = (group.currSatoshi).sub(amountInSatoshi);
    }

    function _verifyMintRequest(
        Group storage group,
        LibRequest.MintRequest calldata request,
        address[] calldata keepers,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 packedV
    ) private {
        require(keepers.length >= group.required, "not enough keepers");

        uint256 cooldownTime = (block.timestamp).add(KEEPER_COOLDOWN);
        bytes32 requestHash = getMintRequestHash(request);

        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];

            require(cooldownUntil[keeper] <= block.timestamp, "keeper is in cooldown");
            require(group.keeperSet.contains(keeper), "keeper is not in group");
            require(
                ecrecover(requestHash, uint8(packedV), r[i], s[i]) == keeper,
                "invalid signature"
            );
            // assert keepers.length <= 32
            packedV >>= 8;

            _cooldown(keeper, cooldownTime);
        }
    }

    // ------------------------------- receipt ---------------------------------
    function _requestDeposit(
        Receipt storage receipt,
        string calldata groupBtcAddress,
        address recipient,
        uint256 amountInSatoshi
    ) private {
        require(receipt.status == Status.Available, "receipt is not in Available state");

        receipt.groupBtcAddress = groupBtcAddress;
        receipt.recipient = recipient;
        receipt.amountInSatoshi = amountInSatoshi;
        receipt.createTimestamp = block.timestamp;
        receipt.status = Status.DepositRequested;
    }

    function _approveDeposit(
        Receipt storage receipt,
        bytes32 txId,
        uint256 height
    ) private {
        require(
            receipt.status == Status.DepositRequested,
            "receipt is not in DepositRequested state"
        );

        receipt.txId = txId;
        receipt.height = height;
        receipt.status = Status.DepositReceived;
    }

    function _revokeDeposit(Receipt storage receipt) private {
        require(receipt.status == Status.DepositRequested, "receipt is not DepositRequested");

        receipt.status = Status.Available;
    }

    function _requestWithdraw(Receipt storage receipt, string calldata withdrawBtcAddress) private {
        require(
            receipt.status == Status.DepositReceived,
            "receipt is not in DepositReceived state"
        );

        receipt.withdrawTimestamp = block.timestamp;
        receipt.withdrawBtcAddress = withdrawBtcAddress;
        receipt.status = Status.WithdrawRequested;
    }

    function _approveWithdraw(Receipt storage receipt) private view {
        require(
            receipt.status == Status.WithdrawRequested,
            "receipt is not in withdraw requested status"
        );

        // cause receipt delete soon, no status change
    }

    function _revokeWithdraw(Receipt storage receipt) private {
        require(
            receipt.status == Status.WithdrawRequested,
            "receipt is not in WithdrawRequested status"
        );

        receipt.status = Status.DepositReceived;
    }

    // -------------------------------- eBTC -----------------------------------
    function _mintEBTC(address to, uint256 amountInSatoshi) private {
        // TODO: add fee deduction
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatoshiMultiplierForEBTC());

        eBTC.mint(to, amount);
    }

    function _burnEBTC(uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatoshiMultiplierForEBTC());

        eBTC.burn(amount);
    }

    function _transferEBTC(address to, uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatoshiMultiplierForEBTC());

        eBTC.transfer(to, amount);
    }

    function _transferFromEBTC(
        address from,
        address to,
        uint256 amountInSatoshi
    ) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatoshiMultiplierForEBTC());

        eBTC.transferFrom(from, to, amount);
    }
}
