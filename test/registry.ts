import { expect } from "chai";
import { Wallet } from "ethers";
import { deployments, ethers, waffle } from "hardhat";
import { KeeperRegistry, ERC20 } from "../build/typechain";

const { parseEther, parseUnits } = ethers.utils;
const parseBtc = (value: string) => parseUnits(value, 8);

const setupFixture = deployments.createFixture(async ({ ethers, deployments }) => {
    const [deployer, ...users] = waffle.provider.getWallets(); // position 0 is used as deployer

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

    for (const user of users) {
        await wbtc.mint(user.address, parseBtc("100"));
        await hbtc.mint(user.address, parseEther("100"));
        await ebtc.mint(user.address, parseEther("100"));

        await wbtc.connect(user).approve(registry.address, parseBtc("100"));
        await hbtc.connect(user).approve(registry.address, parseEther("100"));
        await ebtc.connect(user).approve(registry.address, parseEther("100"));
    }

    return { users, deployer, wbtc, hbtc, ebtc, registry };
});

describe("KeeperRegistry", function () {
    let deployer: Wallet;
    let users: Wallet[];
    let wbtc: ERC20;
    let hbtc: ERC20;
    let ebtc: ERC20;
    let registry: KeeperRegistry;

    beforeEach(async function () {
        ({ users, deployer, wbtc, hbtc, ebtc, registry } = await setupFixture());
    });

    describe("addAsset()", function () {
        it("should add asset", async function () {
            const MockWBTC = await ethers.getContractFactory("MockWBTC");
            const wbtc2 = await MockWBTC.connect(deployer).deploy();

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const hbtc2 = await MockERC20.connect(deployer).deploy();

            await expect(registry.connect(deployer).addAsset(wbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(wbtc2.address);

            await expect(registry.connect(deployer).addAsset(hbtc2.address))
                .to.emit(registry, "AssetAdded")
                .withArgs(hbtc2.address);
        });
    });

    describe("addKeeper()", function () {
        it("should add keeper", async function () {
            const amount = parseBtc("10");
            const asset = wbtc.address;

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[0].address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(users[0].address)).to.be.equal(parseBtc("100"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("0"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);

            await expect(registry.connect(users[0]).addKeeper(asset, amount))
                .to.emit(registry, "KeeperAdded")
                .withArgs(users[0].address, asset, amount);

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(users[0].address, hbtc.address)).to.be.equal(0);
            expect(await wbtc.balanceOf(users[0].address)).to.be.equal(parseBtc("90"));
            expect(await wbtc.balanceOf(registry.address)).to.be.equal(parseBtc("10"));
            expect(await hbtc.balanceOf(users[0].address)).to.be.equal(parseEther("100"));
            expect(await hbtc.balanceOf(registry.address)).to.be.equal(0);
        });

        it("import keepers", async function () {
            const amount = parseBtc("10");
            const asset = wbtc.address;
            const keepers = [users[0].address, users[1].address];
            const auction = deployer;
            await wbtc.connect(users[0]).transfer(auction.address, amount);
            await wbtc.connect(users[1]).transfer(auction.address, amount);

            const transferAmount = amount.mul(keepers.length);
            await wbtc.connect(auction).approve(registry.address, transferAmount);
            expect(await wbtc.balanceOf(auction.address)).to.be.equal(transferAmount);

            await expect(registry.connect(auction).importKeepers(amount, asset, keepers))
                .to.emit(registry, "KeeperImported")
                .withArgs(auction.address, asset, keepers, amount);

            expect(await wbtc.balanceOf(registry.address)).to.be.equal(transferAmount);
            expect(await wbtc.balanceOf(auction.address)).to.be.equal(0);
        });
    });

    describe("punishKeeper()", function () {
        beforeEach(async function () {
            await registry.connect(deployer).addAsset(ebtc.address);
        });

        it("should punish keeper using non-EBTC assets", async function () {
            await registry.connect(users[0]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[1]).addKeeper(hbtc.address, parseEther("10"));

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.collaterals(users[1].address, hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(0);
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(deployer).punishKeeper([users[0].address], parseEther("7"));

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, hbtc.address)).to.be.equal(
                parseEther("10")
            );
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("7"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(0);

            await registry.connect(deployer).punishKeeper([users[1].address], parseEther("5"));

            expect(await registry.collaterals(users[0].address, wbtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, hbtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("12"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
            expect(await registry.confiscations(hbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish ebtc keeper and confiscate the rest", async function () {
            await registry.connect(users[0]).addKeeper(ebtc.address, parseEther("10"));

            await registry.connect(deployer).punishKeeper([users[0].address], parseEther("7"));

            expect(await registry.collaterals(users[0].address, ebtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(parseEther("3"));
        });

        it("should punish ebtc keeper and record the rest as overissues", async function () {
            await registry.connect(users[0]).addKeeper(ebtc.address, parseEther("10"));

            await registry.connect(deployer).punishKeeper([users[0].address], parseEther("12"));

            expect(await registry.collaterals(users[0].address, ebtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("2"));
            expect(await registry.confiscations(ebtc.address)).to.be.equal(0);
        });

        it("should punish ebtc & non-ebtc keepers and confiscate the rest", async function () {
            await registry.connect(users[0]).addKeeper(ebtc.address, parseEther("10"));
            await registry.connect(users[1]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[2]).addKeeper(ebtc.address, parseEther("10"));

            await registry
                .connect(deployer)
                .punishKeeper(
                    [users[0].address, users[1].address, users[2].address],
                    parseEther("9")
                );

            expect(await registry.collaterals(users[0].address, ebtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, ebtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[2].address, wbtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(0);
            expect(await registry.confiscations(ebtc.address)).to.be.equal(parseEther("11"));
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
        });

        it("should punish ebtc & non-ebtc keepers and record the rest as overissues", async function () {
            await registry.connect(users[0]).addKeeper(ebtc.address, parseEther("10"));
            await registry.connect(users[1]).addKeeper(wbtc.address, parseBtc("10"));
            await registry.connect(users[2]).addKeeper(ebtc.address, parseEther("10"));

            await registry
                .connect(deployer)
                .punishKeeper(
                    [users[0].address, users[1].address, users[2].address],
                    parseEther("21")
                );

            expect(await registry.collaterals(users[0].address, ebtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[1].address, ebtc.address)).to.be.equal(0);
            expect(await registry.collaterals(users[2].address, wbtc.address)).to.be.equal(0);
            expect(await registry.overissuedTotal()).to.be.equal(parseEther("1"));
            expect(await registry.confiscations(ebtc.address)).to.be.equal(0);
            expect(await registry.confiscations(wbtc.address)).to.be.equal(parseEther("10"));
        });
    });
});
