import { expect } from "chai";
import { Signer } from "ethers";
import { deployments, ethers } from "hardhat";
import { KeeperRegistry, ERC20 } from "../build/typechain";

const { parseEther, parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);

const setupFixture = deployments.createFixture(
    async ({ ethers, deployments, getNamedAccounts }) => {
        const { deployer } = await getNamedAccounts();
        const users = (await ethers.getSigners()).slice(1, 4); // deployer used position 0
        const owner = await ethers.getSigner(deployer);

        await deployments.deploy("MockWBTC", {
            from: deployer,
            log: true,
        });
        const wbtc = (await ethers.getContract("MockWBTC")) as ERC20;

        await deployments.deploy("MockEBTC", {
            contract: "MockERC20",
            from: deployer,
            log: true,
        });
        const ebtc = (await ethers.getContract("MockEBTC")) as ERC20;

        await deployments.deploy("MockHBTC", {
            contract: "MockERC20",
            from: deployer,
            log: true,
        });
        const hbtc = (await ethers.getContract("MockHBTC")) as ERC20;

        await deployments.deploy("KeeperRegistry", {
            from: deployer,
            args: [[wbtc.address, hbtc.address], ebtc.address],
            log: true,
        });
        const registry = (await ethers.getContract("KeeperRegistry")) as KeeperRegistry;

        for (const user of users) {
            await wbtc.mint(user.address, parseBtc("100"));
            await hbtc.mint(user.address, parseEther("100"));
            await ebtc.mint(user.address, parseEther("100"));

            await wbtc.connect(user).approve(registry.address, parseBtc("100"));
            await hbtc.connect(user).approve(registry.address, parseEther("100"));
            await ebtc.connect(user).approve(registry.address, parseEther("100"));
        }

        return {
            users,
            owner,
            wbtc,
            hbtc,
            ebtc,
            registry,
        };
    }
);

describe("KeeperRegistry", function () {
    let user1: Signer;
    let user2: Signer;
    let user3: Signer;
    let owner: Signer;
    let wbtc: ERC20;
    let hbtc: ERC20;
    let ebtc: ERC20;
    let registry: KeeperRegistry;

    beforeEach(async function () {
        let users;
        ({ users, owner, wbtc, hbtc, ebtc, registry } = await setupFixture());
        [user1, user2, user3] = users;
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
            expect(await registry.collaterals(await user1.getAddress(), wbtc.address)).to.be.equal(
                0
            );
            expect(await registry.collaterals(await user1.getAddress(), hbtc.address)).to.be.equal(
                0
            );
            expect(await wbtc.balanceOf(await user1.getAddress())).to.be.equal(parseBtc("100"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(await user1.getAddress())).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);

            const asset = wbtc.address;
            const amount = parseBtc("10");
            await expect(registry.connect(user1).addKeeper(asset, amount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(await user1.getAddress(), asset, amount);

            expect(await registry.collaterals(await user1.getAddress(), wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(await user1.getAddress(), hbtc.address)).to.be.equal(
                0
            );
            expect(await wbtc.balanceOf(await user1.getAddress())).to.be.equal(parseBtc("90"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(await user1.getAddress())).to.be.equal(parseEther("100"));
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

            expect(await registry.collaterals(await user1.getAddress(), wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(await user2.getAddress(), hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(0);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(owner).punishKeeper([await user1.getAddress()], parseEther("7"));

            expect(await registry.collaterals(await user1.getAddress(), wbtc.address)).to.be.equal(
                0
            );
            expect(await registry.collaterals(await user2.getAddress(), hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("7"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(owner).punishKeeper([await user2.getAddress()], parseEther("5"));

            expect(await registry.collaterals(await user1.getAddress(), wbtc.address)).to.be.equal(
                0
            );
            expect(await registry.collaterals(await user2.getAddress(), hbtc.address)).to.be.equal(
                0
            );
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("12"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish ebtc keeper and confiscate the rest", async function () {
            await registry.connect(user1).addKeeper(ebtc.address, parseEther("10"));

            await registry.connect(owner).punishKeeper([await user1.getAddress()], parseEther("7"));

            expect(await registry.collaterals(await user1.getAddress(), ebtc.address)).to.be.equal(
                0
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(parseEther("3"));
        });

        it("should punish ebtc keeper and record the rest as overissues", async function () {
            await registry.connect(user1).addKeeper(ebtc.address, parseEther("10"));

            await registry
                .connect(owner)
                .punishKeeper([await user1.getAddress()], parseEther("12"));

            expect(await registry.collaterals(await user1.getAddress(), ebtc.address)).to.be.equal(
                0
            );
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("2"));
            expect(await registry.confiscations(ebtc.address)).to.be.equal(0);
        });

        it("should punish ebtc & non-ebtc keepers and confiscate the rest", async function () {
            await registry.connect(user1).addKeeper(ebtc.address, parseEther("10"));
            await registry.connect(user2).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(user3).addKeeper(ebtc.address, parseEther("10"));

            await registry
                .connect(owner)
                .punishKeeper(
                    [await user1.getAddress(), await user2.getAddress(), await user3.getAddress()],
                    parseEther("9")
                );

            expect(await registry.collaterals(await user1.getAddress(), ebtc.address)).to.be.equal(
                0
            );
            expect(await registry.collaterals(await user2.getAddress(), ebtc.address)).to.be.equal(
                0
            );
            expect(await registry.collaterals(await user3.getAddress(), wbtc.address)).to.be.equal(
                0
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(parseEther("11"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish ebtc & non-ebtc keepers and record the rest as overissues", async function () {
            await registry.connect(user1).addKeeper(ebtc.address, parseEther("10"));
            await registry.connect(user2).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(user3).addKeeper(ebtc.address, parseEther("10"));

            await registry
                .connect(owner)
                .punishKeeper(
                    [await user1.getAddress(), await user2.getAddress(), await user3.getAddress()],
                    parseEther("21")
                );

            expect(await registry.collaterals(await user1.getAddress(), ebtc.address)).to.be.equal(
                0
            );
            expect(await registry.collaterals(await user2.getAddress(), ebtc.address)).to.be.equal(
                0
            );
            expect(await registry.collaterals(await user3.getAddress(), wbtc.address)).to.be.equal(
                0
            );
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("1"));
            expect(await registry.confiscations(ebtc.address)).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
        });
    });
});
