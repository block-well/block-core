import { waffle, ethers } from "hardhat";
import { BigNumber, BigNumberish, Wallet } from "ethers";

const mintRequestTypes = [
    { name: "receiptId", type: "bytes32" },
    { name: "txId", type: "bytes32" },
    { name: "height", type: "uint256" },
];

export async function sign(
    signer: Wallet,
    verifyingContract: string,
    receiptId: string,
    txId: string,
    height: BigNumberish
): Promise<string> {
    const domain = {
        name: "DeCus",
        version: "1.0",
        chainId: 31337,
        verifyingContract: verifyingContract,
    };
    const types = {
        MintRequest: mintRequestTypes,
    };
    const value = {
        receiptId: receiptId,
        txId: txId,
        height: height,
    };

    return signer._signTypedData(domain, types, value);
}

export async function prepareSignature(
    keepers: Wallet[],
    verifyingContract: string,
    receiptId: string,
    txId: string,
    height: BigNumberish
): Promise<[string[], string[], BigNumber]> {
    let rList: string[] = [];
    let sList: string[] = [];
    let packedV = BigNumber.from(0);
    let vShift = 0;
    for (let i = 0; i < keepers.length; i++) {
        const signature = await sign(keepers[i], verifyingContract, receiptId, txId, height);

        const sig = ethers.utils.splitSignature(signature);

        rList.push(sig.r);
        sList.push(sig.s);
        packedV = packedV.or(BigNumber.from(sig.v).shl(vShift));

        vShift += 8;
    }
    return [rList, sList, packedV];
}
