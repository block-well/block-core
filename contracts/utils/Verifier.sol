// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/drafts/EIP712.sol";
import {IDeCusSystem} from "../interfaces/IDeCusSystem.sol";

contract Verifier is EIP712 {
    bytes32 private constant REQUEST_TYPEHASH =
        keccak256(abi.encodePacked("MintRequest(bytes32 receiptId,bytes32 txId,uint256 height)"));

    constructor() public EIP712("DeCus", "1.0") {}

    function getMintRequestHash(IDeCusSystem.MintRequest calldata request)
        external
        view
        returns (bytes32)
    {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(REQUEST_TYPEHASH, request.receiptId, request.txId, request.height)
                )
            );
    }
}
