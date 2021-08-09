// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/drafts/EIP712.sol";

import {IDeCusSystem} from "../interfaces/IDeCusSystem.sol";
import {IKeeperRegistry} from "../interfaces/IKeeperRegistry.sol";
import {IToken} from "../interfaces/IToken.sol";
import {ISwapRewarder} from "../interfaces/ISwapRewarder.sol";
import {ISwapFee} from "../interfaces/ISwapFee.sol";
import {BtcUtility} from "../utils/BtcUtility.sol";

contract DeCusSystem is AccessControl, Pausable, IDeCusSystem, EIP712("DeCus", "1.0") {
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant GROUP_ROLE = keccak256("GROUP_ROLE");
    bytes32 private constant REQUEST_TYPEHASH =
        keccak256(abi.encodePacked("MintRequest(bytes32 receiptId,bytes32 txId,uint256 height)"));

    uint32 public constant KEEPER_COOLDOWN = 10 minutes;
    uint32 public constant WITHDRAW_VERIFICATION_END = 1 hours; // TODO: change to 1/2 days for production
    uint32 public constant MINT_REQUEST_GRACE_PERIOD = 1 hours; // TODO: change to 8 hours for production
    uint32 public constant GROUP_REUSING_GAP = 10 minutes; // TODO: change to 30 minutes for production
    uint32 public constant REFUND_GAP = 10 minutes; // TODO: change to 1 day or more for production

    IToken public sats;
    IKeeperRegistry public keeperRegistry;
    ISwapRewarder public rewarder;
    ISwapFee public fee;

    mapping(string => Group) private groups; // btc address -> Group
    mapping(bytes32 => Receipt) private receipts; // receipt ID -> Receipt
    mapping(address => uint32) private cooldownUntil; // keeper address -> cooldown end timestamp

    BtcRefundData private btcRefundData;

    //================================= Public =================================
    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

        _setupRole(GROUP_ROLE, msg.sender);
    }

    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "require admin role");
        _;
    }

    modifier onlyGroupAdmin() {
        require(hasRole(GROUP_ROLE, msg.sender), "require group admin role");
        _;
    }

    function initialize(
        IToken _sats,
        IKeeperRegistry _registry,
        ISwapRewarder _rewarder,
        ISwapFee _fee
    ) external onlyAdmin {
        sats = _sats;
        keeperRegistry = _registry;
        rewarder = _rewarder;
        fee = _fee;
    }

    // ------------------------------ keeper -----------------------------------
    function chill(address keeper, uint32 chillTime) external onlyAdmin {
        _cooldown(keeper, _safeAdd(_blockTimestamp(), chillTime));
    }

    function getCooldownTime(address keeper) external view returns (uint32) {
        return cooldownUntil[keeper];
    }

    // -------------------------------- group ----------------------------------
    function getGroup(string calldata btcAddress)
        external
        view
        returns (
            uint32 required,
            uint32 maxSatoshi,
            uint32 currSatoshi,
            uint32 nonce,
            address[] memory keepers,
            bytes32 workingReceiptId
        )
    {
        Group storage group = groups[btcAddress];

        keepers = new address[](group.keeperSet.length());
        for (uint8 i = 0; i < group.keeperSet.length(); i++) {
            keepers[i] = group.keeperSet.at(i);
        }

        workingReceiptId = getReceiptId(btcAddress, group.nonce);
        required = group.required;
        maxSatoshi = group.maxSatoshi;
        currSatoshi = group.currSatoshi;
        nonce = group.nonce;
    }

    function addGroup(
        string calldata btcAddress,
        uint32 required,
        uint32 maxSatoshi,
        address[] calldata keepers
    ) external onlyGroupAdmin whenNotPaused {
        Group storage group = groups[btcAddress];
        require(group.maxSatoshi == 0, "group id already exist");

        group.required = required;
        group.maxSatoshi = maxSatoshi;
        for (uint8 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            require(keeperRegistry.isKeeperQualified(keeper), "keeper has insufficient collateral");
            group.keeperSet.add(keeper);
            keeperRegistry.incrementRefCount(keeper);
        }

        emit GroupAdded(btcAddress, required, maxSatoshi, keepers);
    }

    function deleteGroup(string calldata btcAddress) external onlyGroupAdmin whenNotPaused {
        Group storage group = groups[btcAddress];

        bytes32 receiptId = getReceiptId(btcAddress, group.nonce);
        Receipt storage receipt = receipts[receiptId];
        require(
            (receipt.status != Status.Available) ||
                (_blockTimestamp() > receipt.updateTimestamp + GROUP_REUSING_GAP),
            "receipt in resuing gap"
        );

        _clearReceipt(receipt, receiptId);

        for (uint8 i = 0; i < group.keeperSet.length(); i++) {
            address keeper = group.keeperSet.at(i);
            keeperRegistry.decrementRefCount(keeper);
        }

        require(group.currSatoshi == 0, "group balance > 0");

        delete groups[btcAddress];

        emit GroupDeleted(btcAddress);
    }

    // ------------------------------- receipt ---------------------------------
    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }

    function getReceiptId(string calldata groupBtcAddress, uint256 nonce)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(groupBtcAddress, nonce));
    }

    function requestMint(
        string calldata groupBtcAddress,
        uint32 amountInSatoshi,
        uint32 nonce
    ) public payable whenNotPaused {
        require(amountInSatoshi > 0, "amount 0 is not allowed");
        fee.payMintEthFee{value: msg.value}();

        Group storage group = groups[groupBtcAddress];
        require(nonce == (group.nonce + 1), "invalid nonce");

        bytes32 prevReceiptId = getReceiptId(groupBtcAddress, group.nonce);
        Receipt storage prevReceipt = receipts[prevReceiptId];
        require(prevReceipt.status == Status.Available, "working receipt in progress");
        require(
            _blockTimestamp() > prevReceipt.updateTimestamp + GROUP_REUSING_GAP,
            "group cooling down"
        );
        delete receipts[prevReceiptId];

        group.nonce = nonce;

        require(
            (group.maxSatoshi - group.currSatoshi) == amountInSatoshi,
            "should fill all group allowance"
        );

        bytes32 receiptId = getReceiptId(groupBtcAddress, nonce);
        Receipt storage receipt = receipts[receiptId];
        _requestDeposit(receipt, groupBtcAddress, amountInSatoshi);

        emit MintRequested(receiptId, msg.sender, amountInSatoshi, groupBtcAddress);
    }

    function revokeMint(bytes32 receiptId) public {
        Receipt storage receipt = receipts[receiptId];
        require(receipt.recipient == msg.sender, "require receipt recipient");

        _revokeMint(receiptId, receipt);
    }

    function forceRequestMint(
        string calldata groupBtcAddress,
        uint32 amountInSatoshi,
        uint32 nonce
    ) public payable {
        bytes32 prevReceiptId = getReceiptId(groupBtcAddress, groups[groupBtcAddress].nonce);
        Receipt storage prevReceipt = receipts[prevReceiptId];

        _clearReceipt(prevReceipt, prevReceiptId);

        requestMint(groupBtcAddress, amountInSatoshi, nonce);
    }

    function verifyMint(
        MintRequest calldata request,
        address[] calldata keepers,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 packedV
    ) public whenNotPaused {
        Receipt storage receipt = receipts[request.receiptId];
        Group storage group = groups[receipt.groupBtcAddress];
        group.currSatoshi += receipt.amountInSatoshi;
        require(group.currSatoshi <= group.maxSatoshi, "amount exceed max allowance");

        _verifyMintRequest(group, request, keepers, r, s, packedV);
        _approveDeposit(receipt, request.txId, request.height);

        _mintSATS(receipt.recipient, receipt.amountInSatoshi);

        rewarder.mintReward(receipt.recipient, receipt.amountInSatoshi);

        emit MintVerified(
            request.receiptId,
            receipt.groupBtcAddress,
            keepers,
            request.txId,
            request.height
        );
    }

    function requestBurn(bytes32 receiptId, string calldata withdrawBtcAddress)
        public
        whenNotPaused
    {
        Receipt storage receipt = receipts[receiptId];

        _requestWithdraw(receipt, withdrawBtcAddress);

        _paySATSForBurn(msg.sender, address(this), receipt.amountInSatoshi);

        emit BurnRequested(receiptId, receipt.groupBtcAddress, withdrawBtcAddress, msg.sender);
    }

    function verifyBurn(bytes32 receiptId) public whenNotPaused {
        Receipt storage receipt = receipts[receiptId];
        require(msg.sender == receipt.recipient, "only recipient");

        _approveWithdraw(receipt);

        _burnSATS(receipt.amountInSatoshi);

        Group storage group = groups[receipt.groupBtcAddress];
        group.currSatoshi -= receipt.amountInSatoshi;

        if (rewarder != ISwapRewarder(0))
            rewarder.burnReward(receipt.recipient, receipt.amountInSatoshi);

        emit BurnVerified(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    function recoverBurn(bytes32 receiptId) public onlyAdmin {
        Receipt storage receipt = receipts[receiptId];

        _revokeWithdraw(receipt);

        _refundSATSForBurn(receipt.recipient, receipt.amountInSatoshi);

        emit BurnRevoked(receiptId, receipt.groupBtcAddress, receipt.recipient, msg.sender);
    }

    // -------------------------------- BTC refund -----------------------------------
    function getRefundData() external view returns (BtcRefundData memory) {
        return btcRefundData;
    }

    function refundBtc(string calldata groupBtcAddress, bytes32 txId)
        public
        onlyAdmin
        whenNotPaused
    {
        bytes32 receiptId = getReceiptId(groupBtcAddress, groups[groupBtcAddress].nonce);
        Receipt storage receipt = receipts[receiptId];

        _clearReceipt(receipt, receiptId);

        require(receipt.status == Status.Available, "receipt not in available state");
        require(btcRefundData.expiryTimestamp < _blockTimestamp(), "refund cool down");

        uint32 expiryTimestamp = _blockTimestamp() + REFUND_GAP;
        btcRefundData.expiryTimestamp = expiryTimestamp;
        btcRefundData.txId = txId;
        btcRefundData.groupBtcAddress = groupBtcAddress;

        emit BtcRefunded(groupBtcAddress, txId, expiryTimestamp);
    }

    // -------------------------------- Pausable -----------------------------------
    function pause() public onlyAdmin {
        _pause();
    }

    function unpause() public onlyAdmin {
        _unpause();
    }

    //=============================== Private ==================================
    // ------------------------------ keeper -----------------------------------
    function _cooldown(address keeper, uint32 cooldownEnd) private {
        cooldownUntil[keeper] = cooldownEnd;
        emit Cooldown(keeper, cooldownEnd);
    }

    function _clearReceipt(Receipt storage receipt, bytes32 receiptId) private {
        if (receipt.status == Status.WithdrawRequested) {
            require(
                _blockTimestamp() > receipt.updateTimestamp + WITHDRAW_VERIFICATION_END,
                "withdraw in progress"
            );
            _forceVerifyBurn(receiptId, receipt);
        } else if (receipt.status == Status.DepositRequested) {
            require(
                _blockTimestamp() > receipt.updateTimestamp + MINT_REQUEST_GRACE_PERIOD,
                "deposit in progress"
            );
            _forceRevokeMint(receiptId, receipt);
        }
    }

    // -------------------------------- group ----------------------------------
    function _revokeMint(bytes32 receiptId, Receipt storage receipt) private {
        _revokeDeposit(receipt);

        emit MintRevoked(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    function _forceRevokeMint(bytes32 receiptId, Receipt storage receipt) private {
        receipt.status = Status.Available;

        emit MintRevoked(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    function _verifyMintRequest(
        Group storage group,
        MintRequest calldata request,
        address[] calldata keepers,
        bytes32[] calldata r,
        bytes32[] calldata s,
        uint256 packedV
    ) private {
        require(keepers.length >= group.required, "not enough keepers");

        uint32 cooldownTime = _blockTimestamp() + KEEPER_COOLDOWN;
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(REQUEST_TYPEHASH, request.receiptId, request.txId, request.height))
        );

        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];

            require(cooldownUntil[keeper] <= _blockTimestamp(), "keeper is in cooldown");
            require(group.keeperSet.contains(keeper), "keeper is not in group");
            require(ecrecover(digest, uint8(packedV), r[i], s[i]) == keeper, "invalid signature");
            // assert keepers.length <= 32
            packedV >>= 8;

            _cooldown(keeper, cooldownTime);
        }
    }

    function _forceVerifyBurn(bytes32 receiptId, Receipt storage receipt) private {
        receipt.status = Status.Available;

        _burnSATS(receipt.amountInSatoshi);

        Group storage group = groups[receipt.groupBtcAddress];
        group.currSatoshi -= receipt.amountInSatoshi;

        emit BurnVerified(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    // ------------------------------- receipt ---------------------------------
    function _requestDeposit(
        Receipt storage receipt,
        string calldata groupBtcAddress,
        uint32 amountInSatoshi
    ) private {
        require(receipt.status == Status.Available, "receipt is not in Available state");

        receipt.groupBtcAddress = groupBtcAddress;
        receipt.recipient = msg.sender;
        receipt.amountInSatoshi = amountInSatoshi;
        receipt.updateTimestamp = _blockTimestamp();
        receipt.status = Status.DepositRequested;
    }

    function _approveDeposit(
        Receipt storage receipt,
        bytes32 txId,
        uint32 height
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

        _markFinish(receipt);
    }

    function _requestWithdraw(Receipt storage receipt, string calldata withdrawBtcAddress) private {
        require(
            receipt.status == Status.DepositReceived,
            "receipt is not in DepositReceived state"
        );

        receipt.recipient = msg.sender;
        receipt.withdrawBtcAddress = withdrawBtcAddress;
        receipt.updateTimestamp = _blockTimestamp();
        receipt.status = Status.WithdrawRequested;
    }

    function _approveWithdraw(Receipt storage receipt) private {
        require(
            receipt.status == Status.WithdrawRequested,
            "receipt is not in withdraw requested status"
        );

        _markFinish(receipt);
    }

    function _revokeWithdraw(Receipt storage receipt) private {
        require(
            receipt.status == Status.WithdrawRequested,
            "receipt is not in WithdrawRequested status"
        );

        receipt.status = Status.DepositReceived;
    }

    function _markFinish(Receipt storage receipt) private {
        receipt.updateTimestamp = _blockTimestamp();
        receipt.status = Status.Available;
    }

    function _blockTimestamp() internal view virtual returns (uint32) {
        return uint32(block.timestamp);
    }

    function _safeAdd(uint32 x, uint32 y) internal pure returns (uint32 z) {
        require((z = x + y) >= x);
    }

    // -------------------------------- SATS -----------------------------------
    function _mintSATS(address to, uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatsAmountMultiplier());

        uint256 feeAmount = fee.payExtraMintFee(to, amount);
        if (feeAmount > 0) {
            sats.mint(address(fee), feeAmount);
            sats.mint(to, amount.sub(feeAmount));
        } else {
            sats.mint(to, amount);
        }
    }

    function _burnSATS(uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatsAmountMultiplier());

        sats.burn(amount);
    }

    // user transfer SATS when requestBurn
    function _paySATSForBurn(
        address from,
        address to,
        uint256 amountInSatoshi
    ) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatsAmountMultiplier());

        uint256 feeAmount = fee.payExtraBurnFee(from, amount);

        sats.transferFrom(from, to, amount.add(feeAmount));

        if (feeAmount > 0) {
            sats.transfer(address(fee), feeAmount);
        }
    }

    // refund user when recoverBurn
    function _refundSATSForBurn(address to, uint256 amountInSatoshi) private {
        // fee is not refunded
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getSatsAmountMultiplier());

        sats.transfer(to, amount);
    }
}
