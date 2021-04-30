import { expect } from "chai";
import { BigNumber, constants, Contract, Wallet } from "ethers";
import { MockContract, MockProvider } from "ethereum-waffle";
import { waffle, ethers } from "hardhat";
import { deployMockForName } from "./mock";

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
        readonly ebtc: Contract;
        readonly registry: Contract;
    }

    let fixtureData: FixtureData;

    let user1: Wallet;
    let user2: Wallet;
    let owner: Wallet;
    let wbtc: Contract;
    let hbtc: Contract;
    let ebtc: Contract;
    let registry: Contract;

    async function deployFixture(_wallets: Wallet[], provider: MockProvider): Promise<FixtureData> {
        const [user1, user2, owner] = provider.getWallets();

        const MockWBTC = await ethers.getContractFactory("MockWBTC");
        const wbtc = await MockWBTC.connect(owner).deploy();

        const MockEBTC = await ethers.getContractFactory("MockERC20");
        const hbtc = await MockEBTC.connect(owner).deploy();
        const ebtc = await MockEBTC.connect(owner).deploy();

        const KeeperRegistry = await ethers.getContractFactory("KeeperRegistry");
        const registry = await KeeperRegistry.connect(owner).deploy(
            [wbtc.address, hbtc.address],
            ebtc.address
        );

        await wbtc.mint(user1.address, parseBtc("100"));
        await wbtc.mint(user2.address, parseBtc("100"));
        await hbtc.mint(user1.address, parseEther("100"));
        await hbtc.mint(user2.address, parseEther("100"));
        await ebtc.mint(user1.address, parseEther("100"));
        await ebtc.mint(user2.address, parseEther("100"));

        await wbtc.connect(user1).approve(registry.address, parseBtc("100"));
        await wbtc.connect(user2).approve(registry.address, parseBtc("100"));
        await hbtc.connect(user1).approve(registry.address, parseEther("100"));
        await hbtc.connect(user2).approve(registry.address, parseEther("100"));
        await ebtc.connect(user1).approve(registry.address, parseEther("100"));
        await ebtc.connect(user2).approve(registry.address, parseEther("100"));

        return {
            wallets: { user1, user2, owner },
            wbtc,
            hbtc,
            ebtc,
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
        ebtc = fixtureData.ebtc;
        registry = fixtureData.registry;
    });

    describe("addAsset()", function () {
        it("should add asset", async function () {
            const MockWBTC = await ethers.getContractFactory("MockWBTC");
            const wbtc2 = await MockWBTC.connect(owner).deploy();

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const hbtc2 = await MockERC20.connect(owner).deploy();

            await expect(registry.connect(owner).addAsset(wbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(wbtc2.address);

            await expect(registry.connect(owner).addAsset(hbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(hbtc2.address);
        });
    });

    describe("addKeeper()", function () {
        it("should add keeper", async function () {
            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(user1.address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(user1.address)).to.be.equal(parseBtc("100"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(user1.address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);

            const asset = wbtc.address;
            const amount = parseBtc("10");
            await expect(registry.connect(user1).addKeeper(asset, amount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(user1.address, asset, amount);

            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(user1.address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(user1.address)).to.be.equal(parseBtc("90"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(user1.address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);
        });
    });

    describe("punishKeeper()", function () {
        beforeEach(async function () {
            await registry.connect(owner).addAsset(ebtc.address);
        });

        it("should punish keeper using non-EBTC assets", async function () {
            await registry.connect(user1).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(user2).addKeeper(hbtc.address, parseEther("10"));

            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(user2.address, hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(0);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(owner).punishKeeper(user1.address, parseEther("7"));

            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(user2.address, hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("7"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(owner).punishKeeper(user2.address, parseEther("5"));

            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(user2.address, hbtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("12"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish ebtc keeper and confiscate the rest", async function () {
            await registry.connect(user1).addKeeper(ebtc.address, parseEther("10"));

            expect(await registry.collaterals(user1.address, ebtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(0);

            await registry.connect(owner).punishKeeper(user1.address, parseEther("7"));

            expect(await registry.collaterals(user1.address, ebtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(parseEther("3"));
        });

        it("should punish ebtc keeper and record the rest as overissues", async function () {
            await registry.connect(user1).addKeeper(ebtc.address, parseEther("10"));

            expect(await registry.collaterals(user1.address, ebtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(0);

            await registry.connect(owner).punishKeeper(user1.address, parseEther("12"));

            expect(await registry.collaterals(user1.address, ebtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("2"));
            expect(await registry.confiscations(ebtc.address)).to.be.equal(0);
        });
    });
});
