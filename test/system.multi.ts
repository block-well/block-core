import { expect } from "chai";
import { BigNumber, Wallet } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
const { parseEther, parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);
import { DeCusSystem, ERC20, KeeperRegistry } from "../build/typechain";

const KEEPER_SATOSHI = parseBtc("0.5"); // 50000000
const GROUP_SATOSHI = parseBtc("0.6");
const BTC_ADDRESS = [
    "38aNsdfsdfsdfsdfsdfdsfsdf0",
    "38aNsdfsdfsdfsdfsdfdsfsdf1",
    "38aNsdfsdfsdfsdfsdfdsfsdf2",
];

let wBtcKeepers: Wallet[];
let hBtcKeepers: Wallet[];

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer
    wBtcKeepers = [users[0], users[1]];
    hBtcKeepers = [users[2], users[3]];

    await deployments.deploy("MockWBTC", {
        from: deployer.address,
        log: true,
    });
    const wbtc = (await ethers.getContract("MockWBTC")) as ERC20;

    await deployments.deploy("MockEBTC", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const ebtc = (await ethers.getContract("MockEBTC")) as ERC20;

    await deployments.deploy("MockHBTC", {
        contract: "MockERC20",
        from: deployer.address,
        log: true,
    });
    const hbtc = (await ethers.getContract("MockHBTC")) as ERC20;

    await deployments.deploy("KeeperRegistry", {
        from: deployer.address,
        args: [[wbtc.address, hbtc.address], ebtc.address],
        log: true,
    });
    const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;

    await deployments.deploy("DeCusSystem", {
        from: deployer.address,
        args: [],
        log: true,
    });
    const system = (await ethers.getContract("DeCusSystem")) as DeCusSystem;

    await deployments.execute(
        "DeCusSystem",
        { from: deployer.address, log: true },
        "initialize",
        ebtc.address,
        registry.address
    );

    for (const user of wBtcKeepers) {
        await wbtc.mint(user.address, parseBtc("100"));
        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await registry.connect(user).addKeeper(wbtc.address, KEEPER_SATOSHI);
    }
    for (const user of hBtcKeepers) {
        await hbtc.mint(user.address, parseEther("100"));
        await hbtc.connect(user).approve(registry.address, parseEther("100"));
        await registry.connect(user).addKeeper(hbtc.address, KEEPER_SATOSHI);
    }

    return { deployer, users, system, wbtc, hbtc, ebtc };
});

describe("DeCusSystemMulti", function () {
    let system: DeCusSystem;
    let group1Keepers: Wallet[];

    beforeEach(async function () {
        ({ system } = await setupFixture());
        group1Keepers = [...wBtcKeepers, ...hBtcKeepers];
    });

    describe("addGroup()", function () {
        it("should add group", async function () {
            const keepers = group1Keepers.map((x) => x.address);
            await expect(system.addGroup(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers))
                .to.emit(system, "GroupAdded")
                .withArgs(BTC_ADDRESS[0], 3, GROUP_SATOSHI, keepers);

            const group = await system.getGroup(BTC_ADDRESS[0]);
            expect(group.required).equal(BigNumber.from(3));
            expect(group.maxSatoshi).equal(BigNumber.from(GROUP_SATOSHI));
            expect(group.currSatoshi).equal(BigNumber.from(0));
            expect(group.nonce).equal(BigNumber.from(0));
            expect(group.keepers).deep.equal(keepers);
            expect(group.workingReceiptId).equal(
                await system.getReceiptId(BTC_ADDRESS[0], group.nonce)
            );
        });
    });
});
