import { expect } from "chai";
import { BigNumber, Contract, Wallet } from "ethers";
import type { MockProvider } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
const { loadFixture } = waffle;
const { parseEther, parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);

describe("KeeperRegistry", function () {
    interface FixtureWalletMap {
        readonly [name: string]: Wallet;
    }

    interface FixtureData {
        readonly wallets: FixtureWalletMap;
        readonly wbtc: Contract;
        readonly hbtc: Contract;
        readonly registry: Contract;
    }

    let fixtureData: FixtureData;

    let user1: Wallet;
    let user2: Wallet;
    let owner: Wallet;
    let wbtc: Contract;
    let hbtc: Contract;
    let registry: Contract;

    async function deployFixture(_wallets: Wallet[], provider: MockProvider): Promise<FixtureData> {
        const [user1, user2, owner] = provider.getWallets();

        const MockWBTC = await ethers.getContractFactory("MockWBTC");
        const wbtc = await MockWBTC.connect(owner).deploy();

        const MockHBTC = await ethers.getContractFactory("MockHBTC");
        const hbtc = await MockHBTC.connect(owner).deploy();

        const KeeperRegistry = await ethers.getContractFactory("KeeperRegistry");
        const registry = await KeeperRegistry.connect(owner).deploy([wbtc.address, hbtc.address]);

        await wbtc.mint(user1.address, parseBtc("100"));
        await wbtc.mint(user2.address, parseBtc("100"));
        await hbtc.mint(user1.address, parseEther("100"));
        await hbtc.mint(user2.address, parseEther("100"));

        await wbtc.connect(user1).approve(registry.address, parseBtc("100"));
        await wbtc.connect(user2).approve(registry.address, parseBtc("100"));
        await hbtc.connect(user1).approve(registry.address, parseEther("100"));
        await hbtc.connect(user2).approve(registry.address, parseEther("100"));

        return {
            wallets: { user1, user2, owner },
            wbtc,
            hbtc,
            registry,
        };
    }

    beforeEach(async function () {
        fixtureData = await loadFixture(deployFixture);
        user1 = fixtureData.wallets.user1;
        user2 = fixtureData.wallets.user2;
        owner = fixtureData.wallets.owner;
        wbtc = fixtureData.wbtc;
        hbtc = fixtureData.hbtc;
        registry = fixtureData.registry;
    });

    describe("addAsset()", function () {
        it("should add asset", async function () {
            const MockWBTC = await ethers.getContractFactory("MockWBTC");
            const wbtc2 = await MockWBTC.connect(owner).deploy();

            const MockHBTC = await ethers.getContractFactory("MockHBTC");
            const hbtc2 = await MockHBTC.connect(owner).deploy();

            await expect(registry.connect(owner).addAsset(wbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(wbtc2.address, BigNumber.from(10).pow(10));

            await expect(registry.connect(owner).addAsset(hbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(hbtc2.address, BigNumber.from(1));
        });
    });

    describe("addKeeper()", function () {
        beforeEach(async function () {
            await registry.connect(owner).addAsset(wbtc.address);
            await registry.connect(owner).addAsset(hbtc.address);
        });
        it("should add keeper", async function () {
            expect(await registry.totalCollaterals(user1.address)).to.be.equal(0);
            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(user1.address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(user1.address)).to.be.equal(parseBtc("100"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(user1.address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(parseEther("0"));

            const assets = [hbtc.address, wbtc.address];
            const amounts = [parseEther("10"), parseBtc("10")];
            await expect(registry.connect(user1).addKeeper(assets, amounts))
                .to.emit(registry, "KeeperAdded")
                .withArgs(user1.address, assets, amounts);

            expect(await registry.totalCollaterals(user1.address)).to.be.equal(parseEther("20"));
            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(user1.address, hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await wbtc.balanceOf(user1.address)).to.be.equal(parseBtc("90"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(user1.address)).to.be.equal(parseEther("90"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(parseEther("10"));
        });
    });
});
