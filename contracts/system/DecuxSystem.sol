// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IDecuxSystem} from "../interfaces/IDecuxSystem.sol";
import {IKeeperRegistry} from "../interfaces/IKeeperRegistry.sol";
import {ISwapRewarder} from "../interfaces/ISwapRewarder.sol";
import {ISwapFee} from "../interfaces/ISwapFee.sol";
import {BtcUtility} from "../utils/BtcUtility.sol";
import {EBTC} from "./EBTC.sol";

contract DecuxSystem is AccessControl, Pausable, IDecuxSystem, EIP712("Decux", "1.0") {
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for EBTC;

    bytes32 public constant GROUP_ROLE = keccak256("GROUP_ROLE");
    bytes32 public constant GUARD_ROLE = keccak256("GUARD_ROLE");
    bytes32 private constant REQUEST_TYPEHASH =
        keccak256(abi.encodePacked("MintRequest(bytes32 receiptId,bytes32 txId,uint256 height)"));

    uint32 public constant KEEPER_COOLDOWN = 10 minutes;
    uint32 public constant WITHDRAW_VERIFICATION_END = 8 hours;
    uint32 public constant MINT_REQUEST_GRACE_PERIOD = 18 hours;
    uint32 public constant GROUP_REUSING_GAP = 30 minutes;
    uint32 public constant REFUND_GAP = 1 days;

    bool public keeperExitAllowed = false;
    EBTC public ebtc;
    IKeeperRegistry public keeperRegistry;
    ISwapRewarder public rewarder;
    ISwapFee public fee;

    mapping(string => Group) private groups; // btc address -> Group
    mapping(bytes32 => Receipt) private receipts; // receipt ID -> Receipt
    mapping(address => uint32) public cooldownUntil; // keeper address -> cooldown end timestamp
    mapping(address => bool) public keeperExiting; // keeper -> exiting

    BtcRefundData private btcRefundData;

    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "require admin role");
        _;
    }

    modifier onlyGroupAdmin() {
        require(hasRole(GROUP_ROLE, msg.sender), "require group admin role");
        _;
    }

    modifier onlyGuard() {
        require(hasRole(GUARD_ROLE, msg.sender), "require guard role");
        _;
    }

    //================================= Public =================================
    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);

        _setupRole(GROUP_ROLE, msg.sender);

        _setupRole(GUARD_ROLE, msg.sender);
    }

    function initialize(
        EBTC _ebtc,
        IKeeperRegistry _registry,
        ISwapRewarder _rewarder,
        ISwapFee _fee
    ) external onlyAdmin {
        ebtc = _ebtc;
        keeperRegistry = _registry;
        rewarder = _rewarder;
        fee = _fee;
    }

    // ------------------------------ keeper -----------------------------------
    function chill(address keeper, uint32 chillTime) external onlyGuard {
        _cooldown(keeper, _safeAdd(_blockTimestamp(), chillTime));
    }

    function allowKeeperExit() external onlyAdmin whenNotPaused {
        keeperExitAllowed = true;
        emit AllowKeeperExit(msg.sender);
    }

    function toggleExitKeeper() external whenNotPaused {
        require(keeperExitAllowed, "keeper exit not allowed");
        keeperExiting[msg.sender] = !keeperExiting[msg.sender];
        emit ToggleExitKeeper(msg.sender, keeperExiting[msg.sender]);
    }

    // -------------------------------- group ----------------------------------
    function getGroup(
        string calldata btcAddress
    )
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
        for (uint256 i = 0; i < group.keeperSet.length(); i++) {
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
        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];
            require(keeperRegistry.isKeeperQualified(keeper), "keeper has insufficient collateral");
            group.keeperSet.add(keeper);
            keeperRegistry.incrementRefCount(keeper);
        }

        emit GroupAdded(btcAddress, required, maxSatoshi, keepers);
    }

    function deleteGroup(string calldata btcAddress) external whenNotPaused {
        Group storage group = groups[btcAddress];

        bool force = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        require(
            force ||
                hasRole(GROUP_ROLE, msg.sender) ||
                (keeperExiting[msg.sender] && group.keeperSet.contains(msg.sender)),
            "not authorized"
        );

        _deleteGroup(btcAddress, group, force);
    }

    function deleteGroups(string[] calldata btcAddresses) external whenNotPaused {
        bool force = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        bool isGroupAdmin = hasRole(GROUP_ROLE, msg.sender);
        for (uint256 i = 0; i < btcAddresses.length; i++) {
            string calldata btcAddress = btcAddresses[i];
            Group storage group = groups[btcAddress];
            require(
                force || isGroupAdmin || group.keeperSet.contains(msg.sender),
                "not authorized"
            );
            _deleteGroup(btcAddress, group, force);
        }
    }

    // ------------------------------- receipt ---------------------------------
    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }

    function getReceiptId(
        string calldata groupBtcAddress,
        uint256 nonce
    ) public pure returns (bytes32) {
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

        _mintebtc(receipt.recipient, receipt.amountInSatoshi);

        rewarder.mintReward(receipt.recipient, receipt.amountInSatoshi);

        emit MintVerified(
            request.receiptId,
            receipt.groupBtcAddress,
            keepers,
            request.txId,
            request.height
        );
    }

    function requestBurn(
        bytes32 receiptId,
        string calldata withdrawBtcAddress
    ) public whenNotPaused {
        Receipt storage receipt = receipts[receiptId];

        _requestWithdraw(receipt, withdrawBtcAddress);

        _payebtcForBurn(msg.sender, address(this), receipt.amountInSatoshi);

        emit BurnRequested(receiptId, receipt.groupBtcAddress, withdrawBtcAddress, msg.sender);
    }

    function verifyBurn(bytes32 receiptId) public whenNotPaused {
        Receipt storage receipt = receipts[receiptId];
        require(msg.sender == receipt.recipient, "only recipient");

        _approveWithdraw(receipt);

        _burnebtc(receipt.amountInSatoshi);

        Group storage group = groups[receipt.groupBtcAddress];
        group.currSatoshi -= receipt.amountInSatoshi;

        if (rewarder != ISwapRewarder(address(0)))
            rewarder.burnReward(receipt.recipient, receipt.amountInSatoshi);

        emit BurnVerified(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    function recoverBurn(bytes32 receiptId) public onlyAdmin {
        Receipt storage receipt = receipts[receiptId];

        _revokeWithdraw(receipt);

        _refundebtcForBurn(receipt.recipient, receipt.amountInSatoshi);

        emit BurnRevoked(receiptId, receipt.groupBtcAddress, receipt.recipient, msg.sender);
    }

    // -------------------------------- BTC refund -----------------------------------
    function getRefundData() external view returns (BtcRefundData memory) {
        return btcRefundData;
    }

    function refundBtc(
        string calldata groupBtcAddress,
        bytes32 txId
    ) public onlyAdmin whenNotPaused {
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
    function pause() public onlyGuard {
        _pause();
    }

    function unpause() public onlyGuard {
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
    function _deleteGroup(string calldata btcAddress, Group storage group, bool force) private {
        bytes32 receiptId = getReceiptId(btcAddress, group.nonce);
        Receipt storage receipt = receipts[receiptId];
        require(
            (receipt.status != Status.Available) ||
                (_blockTimestamp() > receipt.updateTimestamp + GROUP_REUSING_GAP),
            "receipt in resuing gap"
        );

        _clearReceipt(receipt, receiptId);
        if ((force && (receipt.status == Status.DepositReceived))) {
            receipt.status = Status.Available;
            group.currSatoshi = 0;
        }
        delete receipts[receiptId];

        for (uint256 i = 0; i < group.keeperSet.length(); i++) {
            address keeper = group.keeperSet.at(i);
            keeperRegistry.decrementRefCount(keeper);
        }

        require(group.currSatoshi == 0, "group balance > 0");
        delete groups[btcAddress];
        emit GroupDeleted(btcAddress);
    }

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
            require(
                ECDSA.recover(digest, uint8(packedV), r[i], s[i]) == keeper,
                "invalid signature"
            );
            // assert keepers.length <= 32
            packedV >>= 8;

            _cooldown(keeper, cooldownTime);
        }
    }

    function _forceVerifyBurn(bytes32 receiptId, Receipt storage receipt) private {
        receipt.status = Status.Available;

        _burnebtc(receipt.amountInSatoshi);

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

    function _approveDeposit(Receipt storage receipt, bytes32 txId, uint32 height) private {
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

    // -------------------------------- ebtc -----------------------------------
    function _mintebtc(address to, uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getEbtcAmountMultiplier());

        uint256 feeAmount = fee.payExtraMintFee(to, amount);
        if (feeAmount > 0) {
            ebtc.mint(address(fee), feeAmount);
            ebtc.mint(to, amount.sub(feeAmount));
        } else {
            ebtc.mint(to, amount);
        }
    }

    function _burnebtc(uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getEbtcAmountMultiplier());

        ebtc.burn(amount);
    }

    // user transfer ebtc when requestBurn
    function _payebtcForBurn(address from, address to, uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getEbtcAmountMultiplier());

        uint256 feeAmount = fee.payExtraBurnFee(from, amount);

        ebtc.safeTransferFrom(from, to, amount.add(feeAmount));

        if (feeAmount > 0) {
            ebtc.safeTransfer(address(fee), feeAmount);
        }
    }

    // refund user when recoverBurn
    function _refundebtcForBurn(address to, uint256 amountInSatoshi) private {
        // fee is not refunded
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getEbtcAmountMultiplier());

        ebtc.safeTransfer(to, amount);
    }
}
