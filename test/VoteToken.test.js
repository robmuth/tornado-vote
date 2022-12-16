/* global artifacts, web3, contract */


const fs = require("fs");
const Web3 = require("web3");
const { toWei, toBN, BN } = require("web3-utils");
const { takeSnapshot, revertSnapshot } = require("../lib/ganacheHelper");
const snarkjs = require("snarkjs");
const bigInt = snarkjs.bigInt;
const websnarkUtils = require("websnark/src/utils");
const buildGroth16 = require("websnark/src/groth16");
const stringifyBigInts = require("websnark/tools/stringifybigint").stringifyBigInts;
const crypto = require("crypto");
const circomlib = require("circomlib");
const MerkleTree = require("../lib/MerkleTree");

const VoteToken = artifacts.require("./VoteToken.sol");
const VoteTokenJson = require("./../build/contracts/VoteToken.json");
const Tornado = artifacts.require("./ERC20Tornado.sol");

const circuit = require("../build/circuits/withdraw.json");
const proving_key = fs.readFileSync("build/circuits/withdraw_proving_key.bin").buffer;

const { ETH_AMOUNT, TOKEN_AMOUNT, MERKLE_TREE_HEIGHT, FEE, YES_ADDRESS, NO_ADDRESS} = process.env;

const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes));
const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0];
const toFixedHex = (number, length = 32) =>  "0x" + bigInt(number).toString(16).padStart(length * 2, "0");

var web3 = new Web3("HTTP://127.0.0.1:8545");

function generateDeposit() {
  const secret = rbigint(31);
  const nullifier = rbigint(31);
  const preimage = Buffer.concat([nullifier.leInt2Buff(31), secret.leInt2Buff(31)]);
  const commitment = pedersenHash(preimage);

  return {
    secret,
    nullifier,
    preimage,
    commitment
  };
}

async function setAnonymityProviderAddress(tokenAddress, mixAddress, senderAccount) {
  const erc20 = new web3.eth.Contract(VoteTokenJson.abi, tokenAddress);

  var anonymity_provider_addr = await erc20.methods.anonymity_provider().call();

  if(anonymity_provider_addr == "0x0000000000000000000000000000000000000000"){
    anonymity_provider = await erc20.methods.setAnonymityProvider(mixAddress).send({from: senderAccount, gas: 2e6});
    anonymity_provider_addr = await erc20.methods.anonymity_provider().call();

    console.log("set anonymity provider address to ", anonymity_provider_addr);
  }
}

async function registerVoter(senderAccount, tokenAddress, toAccount) {
    const erc20 = await new web3.eth.Contract(VoteTokenJson.abi, tokenAddress);
    return await erc20.methods.transfer(toAccount, 1).send({from: senderAccount, gas: 2e6});
}

async function advanceToNextPhase(nextPhaseBlock) {
  let blocknr = await web3.eth.getBlockNumber();
  const senderAccount = (await web3.eth.getAccounts())[0];

  while(nextPhaseBlock >= blocknr) {
    await web3.eth.sendTransaction({
        from: senderAccount,
        to: "0x0000000000000000000000000000000000000000",
        value: "1"
    });

    blocknr = await web3.eth.getBlockNumber();
  }
}

contract("VoteToken", accounts => {
  let tornado;
  let votetoken;
  let token;
  
  const sender = accounts[0];
  const operator = accounts[0];
  const levels = MERKLE_TREE_HEIGHT || 16;

  let tokenDenomination = TOKEN_AMOUNT; // 1 ether
  let snapshotId;
  let prefix = "test";
  let tree;
  const fee = bigInt(web3.utils.toWei(FEE));
  const refund = ETH_AMOUNT || "1000000000000000000"; // 1 ether
  let recipient = rbigint(20);
  const relayer = accounts[7];
  let groth16;

  before(async () => {
    tree = new MerkleTree(
      levels,
      null,
      prefix,
    );

    votetoken = await VoteToken.deployed();
    tornado = await Tornado.deployed();
    await setAnonymityProviderAddress(votetoken.address, tornado.address, accounts[0]);

    snapshotId = await takeSnapshot();
    groth16 = await buildGroth16();
  });

  describe("#Registration Phase", () => {
    it("lets admin register voters", async () => {
      const erc20 = await new web3.eth.Contract(VoteTokenJson.abi, votetoken.address);

      for(var acc = 1; acc < 2; acc++) {
        await registerVoter(accounts[0], votetoken.address, accounts[acc]);
        let balance = await erc20.methods.balanceOf(accounts[acc]).call();

        assert.equal(balance, 1);
      }
    });

    it("lets admin transfer one token to a voter (but not more than one)", async () => {
        await registerVoter(accounts[0], votetoken.address, accounts[2]);

        try {
          await registerVoter(accounts[0], votetoken.address, accounts[2]);
          assert.fail("Expected error");
        } catch (err) {
          assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Recepient already has a VoteToken");
        }

        try {
          await votetoken.transfer(accounts[2], 2);
          assert.fail("Expected error");
        } catch (err) {
          assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Can only send one vote");
        }
    });

    it("prevents the admin from submitting votes (via direct token transfer)", async () => {
        const erc20 = await new web3.eth.Contract(VoteTokenJson.abi, votetoken.address);

       try {
          await votetoken.transfer(accounts[8], 1, {from: accounts[0]});
        } catch (err) {
          assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Cannot cast no vote at this time");
        }

        try {
          await votetoken.transfer(accounts[9], 1, {from: accounts[0]});
        } catch (err) {
          assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Cannot cast yes vote at this time");
        }
    });

    it("prevents voters from transfer tokens during registration", async () => {
        const erc20 = await new web3.eth.Contract(VoteTokenJson.abi, votetoken.address);

        try {
          await erc20.methods.transfer(accounts[7], 1).send({from: accounts[1]});
        } catch (err) {
          assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Only the administrator can distribute votes");
        }
    });

    it("prevents commitphase start if the admin has more than 1 token", async () => {
      advanceToNextPhase(await votetoken.endphase1());

      const commitment = toFixedHex(43); // TODO: 43?!?!??!?!?!?
      await votetoken.approve(tornado.address, tokenDenomination);

      console.log("Allowance for tornado instance of Account 0: ", (await votetoken.allowance(accounts[0], tornado.address)).toString());
      console.log("Balance of Account 0: ", (await votetoken.balanceOf(accounts[0])).toString());

      try {
        await tornado.deposit(commitment, { from: accounts[0], value: toBN(2* web3.utils.toWei(FEE)) });
      } catch (err) {
        assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Not successful, probably not enough allowed tokens");
      }
    });

  });


  describe("#Commitment and Voting Phase", () => {
    var argsvote; // used for passing secret hash between commit and vote

    it("registers remaining accounts deposits from admin", async () => {
      const erc20 = await new web3.eth.Contract(VoteTokenJson.abi, votetoken.address);

      for(var acc = 3; acc < 5; acc++) {
        await registerVoter(accounts[0], votetoken.address, accounts[acc]);
        const balance = await erc20.methods.balanceOf(accounts[acc]).call();
        assert.equal(balance, "1");
      }

      await advanceToNextPhase(await votetoken.endphase1());

      const commitment = toFixedHex(43);
      await votetoken.approve(tornado.address, tokenDenomination);
      //console.log("allowance : ", (await votetoken.allowance(accounts[0], tornado.address)).toString())
      //console.log("Balance of Account 0: ",(await votetoken.balanceOf(accounts[0])).toString())
      //let blocknr = await web3.eth.getBlockNumber();
      //console.log(blocknr)
      //console.log(web3.utils.toWei(bigInt(2)* fee));
      
      // await tornado.deposit(commitment, { from: accounts[0], value: toBN(2* web3.utils.toWei(FEE)) });

      // let balance_account_0 = await votetoken.balanceOf(accounts[0]);
      // assert.equal(balance_account_0, "0");
    });

    it("prevents a voter from transfers to a contract which is not the anonymity provider", async () => {
        const erc20 = await new web3.eth.Contract(VoteTokenJson.abi, votetoken.address);

        try{
          await erc20.methods.transfer(accounts[7], 1).send({from: accounts[1]});
          assert.fail("Expected error");
        } catch (err) {
          assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Can only send vote to anonymity provider");
        }
    });

    it("should not allow to deposit with wrong fee", async () => {
      const commitment = toFixedHex(43);
      await votetoken.approve(tornado.address, tokenDenomination);

      try {
        await tornado.deposit(commitment, { from: accounts[0], value: toBN(2 * web3.utils.toWei("1")) });
        assert.fail("Expected error");
      } catch (err){
        assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert ETH value is supposed to be double the fee, because two transactions of the relayer are necessary");
      }
    });

    it("commits and and allows note only be used once (casting vote not possible yet)", async () => {
      const deposit = generateDeposit();
      await votetoken.approve(tornado.address, tokenDenomination);

      //console.log("allowance : ", (await votetoken.allowance(accounts[0], tornado.address)).toString())
      //console.log("Balance of Account 0: ",(await votetoken.balanceOf(accounts[0])).toString())
      //let blocknr = await web3.eth.getBlockNumber();
      //console.log(blocknr)
      //console.log(web3.utils.toWei(bigInt(2)* fee));

      await tornado.deposit(toFixedHex(deposit.commitment), { from: accounts[0], value: toBN(2 * web3.utils.toWei(FEE)) });
      await tree.insert(deposit.commitment);

      //let balance_account_0 = (await votetoken.balanceOf(accounts[0])).toString()
      //console.log(balance_account_0)

      //------------------------------------ Start Commitment Test -------------------------------------

      //generate vote commitment
      let vote_commitment_secret = rbigint(31);
      
      var vote_choice = new Uint8Array(1);
      vote_choice[0] = 1;

      const vote_commitment = Buffer.concat([vote_commitment_secret.leInt2Buff(31), Buffer.from(vote_choice.buffer)], 32);
      const vote_commitment_hash = Web3.utils.sha3(vote_commitment);
      const vote_commitment_hash_slice = web3.utils.bytesToHex(Buffer.from(web3.utils.hexToBytes(vote_commitment_hash)).slice(0, 20));

      const { root, path_elements, path_index } = await tree.path(0);
      // Circuit input
      const input = stringifyBigInts({
        // public
        root,
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer,
        recipient: vote_commitment_hash_slice,
        fee,
        refund,

        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: path_elements,
        pathIndices: path_index,
      });

      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key);
      const { proof } = websnarkUtils.toSolidityInput(proofData);

      const balanceTornadoBefore = await votetoken.balanceOf(tornado.address);
      //console.log("balanceTornadoBefore : ", balanceTornadoBefore);
      const balanceRelayerBefore = await votetoken.balanceOf(relayer);
      //console.log("balanceRelayerBefore : ", balanceRelayerBefore);
      //const balanceRecieverBefore = await votetoken.balanceOf(toFixedHex(recipient, 20))
      //console.log("balanceRecieverBefore : ", balanceRecieverBefore);
      const ethBalanceOperatorBefore = await web3.eth.getBalance(operator);
      //console.log("ethBalanceOperatorBefore : ", ethBalanceOperatorBefore);

      const ethBalanceRelayerBefore = await web3.eth.getBalance(relayer);
      //console.log("ethBalanceRelayerBefore : ", ethBalanceRelayerBefore);
      let isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash));
      //console.log(isSpent)
      assert.equal(isSpent, false);

      // Uncomment to measure gas usage
      // gas = await tornado.withdraw.estimateGas(proof, publicSignals, { from: relayer, gasPrice: "0" })
      // console.log("withdraw gas:", gas)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ];
      //console.log(args)
      //console.log("Proof", proof)
      //console.log("Refund", refund)
      ///console.log("Relayer", relayer)

      const { logs } = await tornado.commit(proof, ...args, { value: refund, from: relayer, gasPrice: "0" });
      //console.log(logs)

      const balanceTornadoAfter = await votetoken.balanceOf(tornado.address);
      const balanceRelayerAfter = await votetoken.balanceOf(relayer);
      const ethBalanceOperatorAfter = await web3.eth.getBalance(operator);
      const balanceRecieverAfter = await votetoken.balanceOf(toFixedHex(input.recipient, 20));
      const ethBalanceRecieverAfter = await web3.eth.getBalance(toFixedHex(input.recipient, 20));
      const ethBalanceRelayerAfter = await web3.eth.getBalance(relayer);
      const feeBN = toBN(fee.toString());
      assert.equal(balanceTornadoAfter.toString(), toBN(balanceTornadoBefore).toString());

      //balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).add(feeBN))
      //balanceRecieverAfter.should.be.eq.BN(toBN(balanceRecieverBefore).add(toBN(tokenDenomination).sub(feeBN)))

      //ethBalanceOperatorAfter.should.be.eq.BN(toBN(ethBalanceOperatorBefore))
      //ethBalanceRecieverAfter.should.be.eq.BN(toBN(ethBalanceRecieverBefore).add(toBN(refund)))
      //ethBalanceRelayerAfter.should.be.eq.BN(toBN(ethBalanceRelayerBefore).sub(toBN(refund)))

      //logs[0].event.should.be.equal("Withdrawal")
      //logs[0].args.nullifierHash.should.be.equal(toFixedHex(input.nullifierHash))
      //logs[0].args.relayer.should.be.eq.BN(relayer)
      //logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await tornado.isSpent(toFixedHex(input.nullifierHash));
      assert.equal(isSpent, true);

      try {
        await tornado.commit(proof, ...args, { value: refund, from: relayer, gasPrice: "0" });
        assert.fail("Expected error");
      } catch(err) {
        assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert The note has been already spent");
      }

      // Cast vote should not be possible in this Phase

      let hash_secret = vote_commitment;
      //let buf = Buffer.from(toHex(vote_commitment_secret))
      //  function _processVote(address payable _recipient, bytes20 _randomness, address payable _relayer, uint256 _fee, uint256 _refund) internal
      argsvote = [
        toFixedHex(bigInt("0xB4F5663773fB2842d1A74B2da0b5ec95f2ac125A", "hex"), 20), //not used
        hash_secret,
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund)
      ];

      //console.log(argsvote)
      //console.log("refund", refund)
      //console.log("Casting vote", senderAccount);
      // _processVote(address payable _recipient, bytes20 _randomness, address payable _relayer, uint256 _fee, uint256 _refund)
      try {
        console.log(argsvote);

        await tornado.vote(...argsvote, { value: refund, gas: 1e6 });
        assert.fail("Expected error");
      } catch(err) {
        assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Vote Period has not started yet -- Reason given: Vote Period has not started yet.");
      }
    });

    it("casts a vote and checks that a hash can only be used once", async () => {
      //------------------------------------ Start Vote Casting Test -------------------------------------
      await advanceToNextPhase(await votetoken.endphase2());

      console.log(argsvote);

      await tornado.vote(...argsvote, { value: refund, gas: 1e6 });

      const balance_yes_votes = await votetoken.balanceOf(YES_ADDRESS);
      assert.equal(balance_yes_votes, "1");

      const balanceTornadoAfterV = await votetoken.balanceOf(tornado.address);
      assert.equal(balanceTornadoAfterV, "0");

      try {
        await tornado.vote(...argsvote, { value: refund, gas: 1e6 });
        assert.fail("Expected error");
      } catch(err) {
        assert.equal(err.message, "Returned error: VM Exception while processing transaction: revert Hash does not match any known hash -- Reason given: Hash does not match any known hash.");
      }
    });
  });
});


