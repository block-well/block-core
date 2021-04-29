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
        readonly uniswapRouter: MockContract;
        readonly registry: Contract;
    }

    let fixtureData: FixtureData;

    let user1: Wallet;
    // let user2: Wallet;
    let owner: Wallet;
    let wbtc: Contract;
    let hbtc: Contract;
    let ebtc: Contract;
    let uniswapRouter: MockContract;
    let registry: Contract;

    async function deployFixture(_wallets: Wallet[], provider: MockProvider): Promise<FixtureData> {
        const [user1, user2, owner] = provider.getWallets();

        const MockWBTC = await ethers.getContractFactory("MockWBTC");
        const wbtc = await MockWBTC.connect(owner).deploy();

        const MockEBTC = await ethers.getContractFactory("MockERC20");
        const hbtc = await MockEBTC.connect(owner).deploy();
        const ebtc = await MockEBTC.connect(owner).deploy();

        const uniswapRouter = await deployMockForName(owner, "IUniswapV2Router02");

        const KeeperRegistry = await ethers.getContractFactory("KeeperRegistry");
        const registry = await KeeperRegistry.connect(owner).deploy(
            [wbtc.address, hbtc.address],
            ebtc.address,
            uniswapRouter.address
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
            uniswapRouter,
            registry,
        };
    }

    beforeEach(async function () {
        fixtureData = await loadFixture(deployFixture);
        user1 = fixtureData.wallets.user1;
        // user2 = fixtureData.wallets.user2;
        owner = fixtureData.wallets.owner;
        wbtc = fixtureData.wbtc;
        hbtc = fixtureData.hbtc;
        ebtc = fixtureData.ebtc;
        uniswapRouter = fixtureData.uniswapRouter;
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
                .withArgs(wbtc2.address, BigNumber.from(10).pow(10));

            await expect(registry.connect(owner).addAsset(hbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(hbtc2.address, BigNumber.from(1));
        });
    });

    describe("addKeeper()", function () {
        it("should add keeper", async function () {
            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(user1.address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(user1.address)).to.be.equal(parseBtc("100"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(user1.address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(parseEther("0"));

            const asset = wbtc.address;
            const amount = parseBtc("10");
            await expect(registry.connect(user1).addKeeper(asset, amount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(user1.address, asset, amount);

            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(user1.address, hbtc.address)).to.be.equal(
                parseEther("0")
            );
            expect(await wbtc.balanceOf(user1.address)).to.be.equal(parseBtc("90"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(user1.address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(parseEther("0"));
        });
    });

    describe("punishKeeper()", function () {
        beforeEach(async function () {
            await registry.connect(owner).addAsset(ebtc.address);
            await registry.connect(user1).addKeeper(wbtc.address, parseBtc("10"));

            await uniswapRouter.mock.swapTokensForExactTokens
                .withArgs(
                    parseEther("10"),
                    parseBtc("10"),
                    [wbtc.address, ebtc.address],
                    registry.address,
                    constants.MaxUint256
                )
                .returns([parseBtc("9"), parseEther("10")]);
            await ebtc.mint(registry.address, parseEther("10"));
        });

        it("should punish keeper", async function () {
            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(
                parseEther("10")
            );

            await registry.connect(owner).punishKeeper(user1.address, parseEther("10"));

            expect(await registry.collaterals(user1.address, wbtc.address)).to.be.equal(
                parseEther("1")
            );
        });
    });
});
