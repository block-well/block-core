// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/drafts/EIP712.sol";

import {IDeCusSystem} from "./interfaces/IDeCusSystem.sol";
import {IKeeperRegistry} from "./interfaces/IKeeperRegistry.sol";
import {IToken} from "./interfaces/IToken.sol";
import {BtcUtility} from "./utils/BtcUtility.sol";
import {IFee} from "./interfaces/IFee.sol";

contract DeCusSystem is Ownable, Pausable, IDeCusSystem, EIP712 {
    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 private constant REQUEST_TYPEHASH =
        keccak256(abi.encodePacked("MintRequest(bytes32 receiptId,bytes32 txId,uint256 height)"));

    uint256 public constant KEEPER_COOLDOWN = 10 minutes;
    uint256 public constant WITHDRAW_VERIFICATION_END = 1 hours; // TODO: change to 1/2 days for production
    uint256 public constant MINT_REQUEST_GRACE_PERIOD = 1 hours; // TODO: change to 8 hours for production
    uint256 public constant GROUP_REUSING_GAP = 10 minutes; // TODO: change to 30 minutes for production
    uint256 public constant REFUND_GAP = 10 minutes; // TODO: change to 1 day or more for production
    uint256 public minKeeperWei = 1e13;

    IFee public fee;
    IToken public cong;
    IKeeperRegistry public keeperRegistry;

    mapping(string => Group) private groups; // btc address -> Group
    mapping(bytes32 => Receipt) private receipts; // receipt ID -> Receipt
    mapping(address => uint256) private cooldownUntil; // keeper address -> cooldown end timestamp

    BtcRefundData private btcRefundData;

    //================================= Public =================================
    constructor() public EIP712("DeCus", "1.0") {}

    function initialize(
        address _cong,
        address _registry,
        address _fee
    ) external {
        cong = IToken(_cong);
        keeperRegistry = IKeeperRegistry(_registry);
        fee = IFee(_fee);
    }

    // ------------------------------ keeper -----------------------------------
    function chill(address keeper, uint256 chillTime) external onlyOwner {
        _cooldown(keeper, (block.timestamp).add(chillTime));
    }

    function getCooldownTime(address keeper) external view returns (uint256) {
        return cooldownUntil[keeper];
    }

    function updateMinKeeperWei(uint256 amount) external onlyOwner {
        minKeeperWei = amount;
        emit MinKeeperWeiUpdated(amount);
    }

    // -------------------------------- group ----------------------------------
    function getGroup(string calldata btcAddress)
        external
        view
        returns (
            uint256 required,
            uint256 maxSatoshi,
            uint256 currSatoshi,
            uint256 nonce,
            GroupStatus status,
            address[] memory keepers,
            uint256 cooldown,
            bytes32 workingReceiptId
        )
    {
        Group storage group = groups[btcAddress];

        status = getGroupStatus(btcAddress);

        keepers = new address[](group.keeperSet.length());
        cooldown = 0;
        for (uint256 i = 0; i < group.keeperSet.length(); i++) {
            address keeper = group.keeperSet.at(i);
            if (cooldownUntil[keeper] <= block.timestamp) {
                cooldown += 1;
            }
            keepers[i] = keeper;
        }

        workingReceiptId = getReceiptId(btcAddress, group.nonce);

        return (
            group.required,
            group.maxSatoshi,
            group.currSatoshi,
            group.nonce,
            status,
            keepers,
            cooldown,
            workingReceiptId
        );
    }

    function listGroupStatus(string[] calldata btcAddressArray)
        external
        view
        returns (GroupStatus[] memory statusArray)
    {
        statusArray = new GroupStatus[](btcAddressArray.length);
        for (uint256 i = 0; i < btcAddressArray.length; i++) {
            statusArray[i] = getGroupStatus(btcAddressArray[i]);
        }
        return statusArray;
    }

    function getGroupStatus(string calldata btcAddress) public view returns (GroupStatus status) {
        Group storage group = groups[btcAddress];
        if (group.required == 0) {
            return GroupStatus.None;
        }

        bytes32 _receiptId = getReceiptId(btcAddress, group.nonce);
        Receipt storage receipt = receipts[_receiptId];
        if (receipt.status == Status.Available) {
            status = block.timestamp > receipt.updateTimestamp.add(GROUP_REUSING_GAP)
                ? GroupStatus.Available
                : GroupStatus.MintGap;
        } else if (receipt.status == Status.DepositRequested) {
            status = block.timestamp > MINT_REQUEST_GRACE_PERIOD.add(receipt.updateTimestamp)
                ? GroupStatus.MintTimeout
                : GroupStatus.MintRequested;
        } else if (receipt.status == Status.DepositReceived) {
            status = GroupStatus.MintVerified;
        } else if (receipt.status == Status.WithdrawRequested) {
            status = block.timestamp > WITHDRAW_VERIFICATION_END.add(receipt.updateTimestamp)
                ? GroupStatus.BurnTimeout
                : GroupStatus.BurnRequested;
        } else {
            status = GroupStatus.None;
        }
        return status;
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
                keeperRegistry.getCollateralWei(keeper) >= minKeeperWei,
                "keeper has not enough collateral"
            );
            group.keeperSet.add(keeper);
        }

        emit GroupAdded(btcAddress, required, maxSatoshi, keepers);
    }

    function deleteGroup(string calldata btcAddress) external onlyOwner {
        Group storage group = groups[btcAddress];

        bytes32 receiptId = getReceiptId(btcAddress, group.nonce);
        Receipt storage receipt = receipts[receiptId];
        require(
            (receipt.status != Status.Available) ||
                (block.timestamp > receipt.updateTimestamp.add(GROUP_REUSING_GAP)),
            "receipt in resuing gap"
        );

        _clearReceipt(receipt, receiptId);

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
        uint256 amountInSatoshi,
        uint256 nonce
    ) public {
        require(amountInSatoshi > 0, "amount 0 is not allowed");

        Group storage group = groups[groupBtcAddress];
        require(nonce == (group.nonce).add(1), "invalid nonce");

        bytes32 prevReceiptId = getReceiptId(groupBtcAddress, group.nonce);
        Receipt storage prevReceipt = receipts[prevReceiptId];
        require(prevReceipt.status == Status.Available, "working receipt in progress");
        require(
            block.timestamp > prevReceipt.updateTimestamp.add(GROUP_REUSING_GAP),
            "group cooling down"
        );
        delete receipts[prevReceiptId];

        group.nonce = nonce;

        require(
            (group.maxSatoshi).sub(group.currSatoshi) == amountInSatoshi,
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
        uint256 amountInSatoshi,
        uint256 nonce
    ) public {
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
    ) public {
        Receipt storage receipt = receipts[request.receiptId];
        Group storage group = groups[receipt.groupBtcAddress];
        group.currSatoshi = (group.currSatoshi).add(receipt.amountInSatoshi);
        require(group.currSatoshi <= group.maxSatoshi, "amount exceed max allowance");

        _verifyMintRequest(group, request, keepers, r, s, packedV);
        _approveDeposit(receipt, request.txId, request.height);

        _mintCONG(receipt.recipient, receipt.amountInSatoshi);

        emit MintVerified(request.receiptId, receipt.groupBtcAddress, keepers);
    }

    function requestBurn(bytes32 receiptId, string calldata withdrawBtcAddress) public {
        Receipt storage receipt = receipts[receiptId];

        _requestWithdraw(receipt, withdrawBtcAddress);

        _transferFromCONG(msg.sender, address(this), receipt.amountInSatoshi);

        emit BurnRequested(receiptId, receipt.groupBtcAddress, withdrawBtcAddress, msg.sender);
    }

    function verifyBurn(bytes32 receiptId) public {
        // TODO: allow only user or keepers to verify? If someone verified wrongly, we can punish
        Receipt storage receipt = receipts[receiptId];

        _approveWithdraw(receipt);

        _burnCONG(receipt.amountInSatoshi);

        Group storage group = groups[receipt.groupBtcAddress];
        group.currSatoshi = (group.currSatoshi).sub(receipt.amountInSatoshi);

        emit BurnVerified(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    function recoverBurn(bytes32 receiptId) public onlyOwner {
        Receipt storage receipt = receipts[receiptId];

        _revokeWithdraw(receipt);

        _transferCONG(msg.sender, receipt.amountInSatoshi);

        emit BurnRevoked(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    //=============================== Private ==================================
    // ------------------------------ keeper -----------------------------------
    function _cooldown(address keeper, uint256 cooldownEnd) private {
        cooldownUntil[keeper] = cooldownEnd;
        emit Cooldown(keeper, cooldownEnd);
    }

    function _clearReceipt(Receipt storage receipt, bytes32 receiptId) private {
        if (receipt.status == Status.WithdrawRequested) {
            require(
                block.timestamp > (receipt.updateTimestamp).add(WITHDRAW_VERIFICATION_END),
                "withdraw in progress"
            );
            _forceVerifyBurn(receiptId, receipt);
        } else if (receipt.status == Status.DepositRequested) {
            require(
                block.timestamp > (receipt.updateTimestamp).add(MINT_REQUEST_GRACE_PERIOD),
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

        uint256 cooldownTime = (block.timestamp).add(KEEPER_COOLDOWN);
        // bytes32 requestHash = getMintRequestHash(request);
        bytes32 digest =
            _hashTypedDataV4(
                keccak256(
                    abi.encode(REQUEST_TYPEHASH, request.receiptId, request.txId, request.height)
                )
            );

        for (uint256 i = 0; i < keepers.length; i++) {
            address keeper = keepers[i];

            require(cooldownUntil[keeper] <= block.timestamp, "keeper is in cooldown");
            require(group.keeperSet.contains(keeper), "keeper is not in group");
            require(ecrecover(digest, uint8(packedV), r[i], s[i]) == keeper, "invalid signature");
            // assert keepers.length <= 32
            packedV >>= 8;

            _cooldown(keeper, cooldownTime);
        }
    }

    function _forceVerifyBurn(bytes32 receiptId, Receipt storage receipt) private {
        receipt.status = Status.Available;

        _burnCONG(receipt.amountInSatoshi);

        Group storage group = groups[receipt.groupBtcAddress];
        group.currSatoshi = (group.currSatoshi).sub(receipt.amountInSatoshi);

        emit BurnVerified(receiptId, receipt.groupBtcAddress, msg.sender);
    }

    // ------------------------------- receipt ---------------------------------
    function _requestDeposit(
        Receipt storage receipt,
        string calldata groupBtcAddress,
        uint256 amountInSatoshi
    ) private {
        require(receipt.status == Status.Available, "receipt is not in Available state");

        receipt.groupBtcAddress = groupBtcAddress;
        receipt.recipient = msg.sender;
        receipt.amountInSatoshi = amountInSatoshi;
        receipt.updateTimestamp = block.timestamp;
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

        _markFinish(receipt);
    }

    function _requestWithdraw(Receipt storage receipt, string calldata withdrawBtcAddress) private {
        require(
            receipt.status == Status.DepositReceived,
            "receipt is not in DepositReceived state"
        );

        receipt.withdrawBtcAddress = withdrawBtcAddress;
        receipt.updateTimestamp = block.timestamp;
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
        receipt.updateTimestamp = block.timestamp;
        receipt.status = Status.Available;
    }

    // -------------------------------- CONG -----------------------------------
    function _mintCONG(address to, uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getCongAmountMultiplier());

        uint8 feeBps = fee.getMintFeeBps();
        if (feeBps > 0) {
            uint256 reserveAmount = amount.mul(feeBps).div(10000);
            cong.mint(address(this), reserveAmount);
            cong.mint(to, amount.sub(reserveAmount));
        } else {
            cong.mint(to, amount);
        }
    }

    function _burnCONG(uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getCongAmountMultiplier());

        cong.burn(amount);
    }

    function _transferCONG(address to, uint256 amountInSatoshi) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getCongAmountMultiplier());

        cong.transfer(to, amount);
    }

    function _transferFromCONG(
        address from,
        address to,
        uint256 amountInSatoshi
    ) private {
        uint256 amount = (amountInSatoshi).mul(BtcUtility.getCongAmountMultiplier());

        // add fee
        uint8 feeBps = fee.getBurnFeeBps();
        if (feeBps > 0) {
            uint256 reserveAmount = amount.mul(feeBps).div(10000);
            cong.transferFrom(from, to, amount.add(reserveAmount));
        } else {
            cong.transferFrom(from, to, amount);
        }
    }

    // -------------------------------- BTC refund -----------------------------------
    function getRefundData() external view returns (BtcRefundData memory) {
        return btcRefundData;
    }

    function refundBtc(string calldata groupBtcAddress, bytes32 txId) public onlyOwner {
        bytes32 receiptId = getReceiptId(groupBtcAddress, groups[groupBtcAddress].nonce);
        Receipt storage receipt = receipts[receiptId];

        _clearReceipt(receipt, receiptId);

        require(receipt.status == Status.Available, "receipt not in available state");
        require(btcRefundData.expiryTimestamp < block.timestamp, "refund cool down");

        uint256 expiryTimestamp = block.timestamp.add(REFUND_GAP);
        btcRefundData.expiryTimestamp = expiryTimestamp;
        btcRefundData.txId = txId;
        btcRefundData.groupBtcAddress = groupBtcAddress;

        emit BtcRefunded(groupBtcAddress, txId, expiryTimestamp);
    }

    // -------------------------------- Collect Fee -----------------------------------
    function collectFee(uint256 amount) public onlyOwner {
        // be careful not to transfer unburned Cong
        cong.transfer(msg.sender, amount);
    }
}
