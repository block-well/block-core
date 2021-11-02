import { WEEK, DAY } from "./test/time";

export const KEEPER_CONFIG = {
    UNIT_AMOUNT: process.env.UNIT_AMOUNT ?? "0.0001",
};

export const GOVERN_CONFIG = {
    TIMELOCK_SKIP: Boolean(process.env.TIMELOCK_SKIP),
    TIMELOCK_DELAY: process.env.TIMELOCK_DELAY ?? 15 * 60, // 15 minutes for test, 2 days for prod
    TIMELOCKING: Boolean(process.env.TIMELOCKING),
};

export const SWAP_CONFIG = {
    MINT_REWARD_DCS: process.env.MINT_REWARD_DCS ?? "200",
    BURN_REWARD_DCS: process.env.BURN_REWARD_DCS ?? "0",
    MINT_GAS_PRICE: process.env.MINT_GAS_PRICE ?? 10,
    MINT_GAS_USED: process.env.MINT_GAS_USED ?? 300000,
    BURN_FEE_DCS: process.env.BURN_FEE_DCS ?? "100",
    REWARD_TOTAL_DCS: process.env.REWARD_TOTAL_DCS ?? "200000", // 1000 times of mint
};

export const AIRDROP_CONFIG = {
    MERKLE_ROOT: process.env.AIRDROP_MERKLE_ROOT ?? "",
    UNLOCK_TIMESPAN: process.env.AIRDROP_UNLOCK_TIMESPAN ?? WEEK,
    SPEED: process.env.AIRDROP_SPEED ?? "20000000000", // 1 lp to 20000000000 dcs
    TOTAL_DCS: process.env.AIRDROP_TOTAL_DCS ?? "100000000000000",
};

export const STAKING_CONFIG = {
    MONTHLY_DCS: process.env.STAKING_MONTHLY_DCS ?? "6250000",
    START_TS: Number(process.env.STAKING_START_TS),
    DURATION: Number(process.env.STAKING_DURATION), // 3600 * 24 * 7 * 2, // 2 weeks
};

export const KEEPER_REWARD_CONFIG = {
    VALIDATOR: process.env.KEEPER_REWARD_VALIDATOR ?? "",
    START_TS: Number(process.env.KEEPER_REWARD_START_TS), // 1632024000 for 2021.9.19 12:00
    DURATION: Number(process.env.KEEPER_REWARD_DURATION) ?? WEEK * 26,
};

export const LIQUIDATION_CONFIG = {
    START_TS: Number(process.env.LIQUIDATION_START_TS), // 1632024000 for 2021.9.19 12:00
    DURATION: Number(process.env.LIQUIDATION_DURATION) ?? DAY,
};
