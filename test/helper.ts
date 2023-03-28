import { ethers } from "hardhat";
import { BigNumber, BigNumberish, Wallet } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
const { solidityKeccak256 } = ethers.utils;

const mintRequestTypes = [
    { name: "receiptId", type: "bytes32" },
    { name: "txId", type: "bytes32" },
    { name: "height", type: "uint256" },
];

export async function sign(
    signer: SignerWithAddress,
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
    keepers: SignerWithAddress[],
    verifyingContract: string,
    receiptId: string,
    txId: string,
    height: BigNumberish
): Promise<[string[], string[], BigNumber]> {
    const rList: string[] = [];
    const sList: string[] = [];
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

export const currentTime = async (): Promise<number> => {
    return (await ethers.provider.getBlock("latest")).timestamp;
};

export const advanceTime = async (time: number): Promise<unknown> => {
    return ethers.provider.send("evm_increaseTime", [time]);
};

export const advanceBlock = async (): Promise<unknown> => {
    return ethers.provider.send("evm_mine", []);
};

export const advanceTimeAndBlock = async (time: number): Promise<unknown> => {
    return ethers.provider.send("evm_mine", [(await currentTime()) + time]);
};

export const advanceBlockAtTime = async (time: number): Promise<unknown> => {
    return ethers.provider.send("evm_mine", [time]);
};

/**
 * Note that failed transactions are silently ignored when automining is disabled.
 */
export const setAutomine = async (flag: boolean): Promise<unknown> => {
    return ethers.provider.send("evm_setAutomine", [flag]);
};

export const getReceiptId = (btcAddress: string, nonce: number): string => {
    return solidityKeccak256(["string", "uint256"], [btcAddress, nonce]);
};

export const enum GroupStatus {
    None,
    Available,
    MintRequested,
    MintVerified,
    MintTimeout,
    BurnRequested,
    BurnTimeout,
    MintGap,
}

export const enum Status {
    Available,
    DepositRequested,
    DepositReceived,
    WithdrawRequested,
}
