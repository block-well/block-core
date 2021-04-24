// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "./LibEIP712.sol";

contract LibRequest is LibEIP712 {
    string private constant REQUEST_TYPE =
        "MintRequest(bytes32 receiptId,bytes32 txId,uint256 height)";
    bytes32 private constant REQUEST_TYPEHASH = keccak256(abi.encodePacked(REQUEST_TYPE));

    // solhint-disable max-line-length
    struct MintRequest {
        bytes32 receiptId;
        bytes32 txId;
        uint256 height;
    }

    function getMintRequestHash(MintRequest memory request)
        internal
        view
        returns (bytes32 requestHash)
    {
        return hashEIP712Message(hashMintRequest(request));
    }

    function hashMintRequest(MintRequest memory request) private pure returns (bytes32 result) {
        return
            keccak256(
                abi.encode(REQUEST_TYPEHASH, request.receiptId, request.txId, request.height)
            );
    }
}
