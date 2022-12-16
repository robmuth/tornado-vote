#!/usr/bin/env node
// Temporary demo client
// Works both in browser and node.js

require("dotenv").config();
const fs = require("fs");
const axios = require("axios");
const assert = require("assert");
const snarkjs = require("snarkjs");
const crypto = require("crypto");
const circomlib = require("circomlib");
const bigInt = snarkjs.bigInt;
const merkleTree = require("./lib/MerkleTree");
const Web3 = require("web3");
const buildGroth16 = require("websnark/src/groth16");
const websnarkUtils = require("websnark/src/utils");
const { toWei, fromWei, toBN, BN } = require("web3-utils");
const config = require("./config");
const program = require("commander");
var https = require("https");;

const VoteTokenJson =  require("./build/contracts/VoteToken.json");


let web3, tornado, circuit, proving_key, groth16, voteToken, senderAccount, netId;
let MERKLE_TREE_HEIGHT, ETH_AMOUNT, TOKEN_AMOUNT, PRIVATE_KEY, PARTICIPANTS_PATH;

/** Whether we are in a browser or node.js */
const inBrowser = (typeof window !== "undefined")
let isLocalRPC = false

/** Generate random number of specified byte length */
const rbigint = nbytes => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))

/** Compute pedersen hash */
const pedersenHash = data => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]

/** BigNumber to hex string of specified length */
function toHex(number, length = 32) {
  const str = number instanceof Buffer ? number.toString("hex") : bigInt(number).toString(16)
  return "0x" + str.padStart(length * 2, "0")
}

async function advanceToNextPhase(web3, nextPhaseBlock) {
  console.log("Advancing to Block number", nextPhaseBlock);
  var blocknr = await web3.eth.getBlockNumber();

  while(nextPhaseBlock >= blocknr) {
    web3.eth.sendTransaction({
        from: senderAccount,
        to: "0x0000000000000000000000000000000000000000",
        value: "1"
    });

    blocknr = await web3.eth.getBlockNumber();
  }
}

function sleep(milliseconds) {
   return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Create deposit object from secret and nullifier
 */
function createDeposit({ nullifier, secret}) {
  const deposit = { nullifier, secret }
  deposit.preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(deposit.preimage)
  deposit.commitmentHex = toHex(deposit.commitment)
  deposit.nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31))
  deposit.nullifierHex = toHex(deposit.nullifierHash)
  return deposit
}


/**
 * Generate merkle tree for a deposit.
 * Download deposit events from the tornado, reconstructs merkle tree, finds our deposit leaf
 * in it and generates merkle proof
 * @param deposit Deposit object
 */
async function generateMerkleProof(deposit) {
  // Get all deposit events from smart contract and assemble merkle tree from them
  console.log("Getting current state from tornado contract");

  const events = await tornado.getPastEvents("Deposit", { fromBlock: 0, toBlock: "latest" });

  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map(e => e.returnValues.commitment);

  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves);

  // Find current commitment in the tree
  const depositEvent = events.find(e => e.returnValues.commitment === toHex(deposit.commitment));
  const leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1;

  // Validate that our data is correct
  const root = await tree.root();
  const isValidRoot = await tornado.methods.isKnownRoot(toHex(root)).call();
  const isSpent = await tornado.methods.isSpent(toHex(deposit.nullifierHash)).call();
  
  assert(isValidRoot === true, "Merkle tree is corrupted");
  assert(isSpent === false, "The note is already spent");
  assert(leafIndex >= 0, "The deposit is not found in the tree");

  // Compute merkle proof of our commitment
  return tree.path(leafIndex)
}

/**
 * Generate SNARK proof for withdrawal
 * @param deposit Deposit object
 * @param recipient Funds recipient
 * @param relayer Relayer address
 * @param fee Relayer fee
 * @param refund Receive ether for exchanged tokens
 */
async function generateProof({ deposit, recipient, relayerAddress = 0, fee = 0, refund = 0 }) {
  // Compute merkle proof of our commitment
  const { root, path_elements, path_index } = await generateMerkleProof(deposit);
  console.log(recipient)
  // Prepare circuit input
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    recipient: bigInt(recipient),
    relayer: bigInt(relayerAddress),
    fee: bigInt(fee),
    refund: bigInt(refund),

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndices: path_index,
  }
  console.log("----------------------------------")

  console.log("Generating SNARK proof")
  console.time("Proof time")
  const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)

  const { proof } = websnarkUtils.toSolidityInput(proofData)
  console.timeEnd("Proof time")

  const args = [
    toHex(input.root),
    toHex(input.nullifierHash),
    toHex(input.recipient, 20),
    toHex(input.relayer, 20),
    toHex(input.fee),
    toHex(input.refund)
  ];

  return { proof, args };
}



/**
 * Parses Tornado.cash note
 * @param noteString the note
 */
function parseNote(noteString) {
  let tokenaddress
  const noteRegex = /tornado-vote-(?<tokenaddress>\w+)-(?<netId>\d+)-0x(?<note>[0-9a-fA-F]{124})/g

  const match = noteRegex.exec(noteString)
  if (!match) {
    throw new Error("The note has invalid format", noteString)
  }

  const buf = Buffer.from(match.groups.note, "hex")
  const nullifier = bigInt.leBuff2int(buf.slice(0, 31))
  const secret = bigInt.leBuff2int(buf.slice(31, 62))
  const deposit = createDeposit({ nullifier, secret })
  const netId = Number(match.groups.netId)

  return {tokenaddress, netId, deposit }
}


/**
 * Init web3, contracts, and snark
 */
async function init(web3, noteNetId, tokenAddress) {
  let contractJson, voteTokenJson, erc20tornadoJson, tornadoAddress;

  circuit = require("./build/circuits/withdraw.json");
  proving_key = fs.readFileSync("build/circuits/withdraw_proving_key.bin").buffer;
  MERKLE_TREE_HEIGHT = 20;
  ETH_AMOUNT = 100000000000000000;
  TOKEN_AMOUNT = 1;

  senderAccount = (await web3.eth.getAccounts())[0];
  web3.eth.defaultAccount = senderAccount;

  voteTokenJson = require("./build/contracts/VoteToken.json");
  erc20tornadoJson = require("./build/contracts/ERC20Tornado.json");

  // groth16 initialises a lot of Promises that will never be resolved, that's why we need to use process.exit to terminate the CLI
  groth16 = await buildGroth16();
  
  netId = await web3.eth.net.getId();

  console.log("NetId is ", netId);

  let erc20tornadoJsonIndex = Object.keys(erc20tornadoJson.networks).slice(-1)[0];
  tornadoAddress = erc20tornadoJson.networks[erc20tornadoJsonIndex].address;

  tornado = new web3.eth.Contract(erc20tornadoJson.abi, tornadoAddress);
  voteToken =  new web3.eth.Contract(voteTokenJson.abi, tokenAddress);
}

async function main() {
  let voter_array = [];

  const VOTERS = parseInt(process.env.INITIAL_SUPPLY);// process.env.INITIAL_SUPPLY;

  var netId = 1337;
  var netUrl = "http://127.0.0.1:8545";
  var web3 = await new Web3(netUrl, null, { transactionConfirmationBlocks: 1 });


  let tokenNetworkIndex = Object.keys(VoteTokenJson.networks).slice(-1)[0];
  console.log("tokenNetworkIndex", tokenNetworkIndex);

  let tokenAddress = VoteTokenJson.networks[tokenNetworkIndex].address;
  console.log("tokenAddress", tokenAddress);

  await init(web3, netId, tokenAddress);
  


  votetoken = await new web3.eth.Contract(VoteTokenJson.abi, tokenAddress);
  erc20tornadoJson = require("./build/contracts/ERC20Tornado.json");

  let tornadoAddressIndex = Object.keys(erc20tornadoJson.networks).slice(-1)[0];
  tornadoAddress = erc20tornadoJson.networks[tornadoAddressIndex].address;
  tornado = await new web3.eth.Contract(erc20tornadoJson.abi, tornadoAddress);


  console.log("Sender address ", senderAccount);
  console.log("tornadoAddress", tornadoAddress);
  console.log("Vote token address is ",tokenAddress);
  //registering the tornado contract address if not already happened
  var success = false;
  while(!success) {
    try {
      var anonProviderAddr = await votetoken.methods.anonymity_provider().call();
      console.log("anonymity provider address is ", anonProviderAddr);

      if(anonProviderAddr == "0x0000000000000000000000000000000000000000") {
        console.log("Setting anonymity provider")
        anonymity_provider = await votetoken.methods.setAnonymityProvider(tornadoAddress.toString()).send({ from: senderAccount, gasLimit: 2e6 });

        await votetoken.methods.anonymity_provider().call();
        success = true;
      } else {
        success = true;
      }
    } catch(e){
      console.log(e);
    }
  }

  var gas_register = [], gas_approve = [], gas_deposit = [], gas_commit = [], gas_vote = [];

  var blocknr = await web3.eth.getBlockNumber();
  let endRegistrationPhaseBlocknr = await votetoken.methods.endphase1().call() * 1;
  let endCommitPhaseBlocknr = await votetoken.methods.endphase2().call() * 1;
  let endblockelectionBlocknr = await votetoken.methods.endblockelection().call() * 1;

  const YES_ADDRESS = await votetoken.methods.yes().call();
  const NO_ADDRESS = await votetoken.methods.no().call();

  console.log("Current Block", blocknr)
  console.log("EndRegistrationPhaseBlocknr", endRegistrationPhaseBlocknr);
  console.log("EndCommitPhaseBlocknr", endCommitPhaseBlocknr);
  console.log("EndblockelectionBlocknr", endblockelectionBlocknr);

  console.log("yes address", YES_ADDRESS);
  console.log("no address", NO_ADDRESS);

  for(let i = 0; i < VOTERS; i++) {
    voter_array[i] = web3.eth.accounts.create(["entropy"]);
    web3.eth.accounts.wallet.add(voter_array[i]);

    success = false;
    console.log("Sender Acoount", senderAccount);
    while (!success) {
      try {
        await web3.eth.sendTransaction({
            from: senderAccount,
            to: voter_array[i].address,
            gas: 2e6,
            gasPrice: web3.utils.toHex(web3.utils.toWei("1", "gwei")),
            value: toWei("0.07")
        }).on("transactionHash", function (txHash) {
          console.log("ETH funding of new account txhash: ", txHash);
        })

        success = true;
      } catch (e) {
        console.log(e);
        success = false;
      }
    }

    success = false;
    while (!success) {
      try {
          console.log(`Sending to ${voter_array[i].address.toString()} from ${senderAccount}`);

          let res = await votetoken.methods.transfer(voter_array[i].address.toString(), 1).send({ from: senderAccount, gas: 5e6 })
            .on("receipt", (receipt) => {
              gas_register = [...gas_register, receipt.gasUsed];
            });

          success = true;
      } catch(e) {
          console.error(e);
          console.error("Tokens probably already distributed");
        }
    }

    console.log(voter_array[i].address + " owns " + (await web3.eth.getBalance(voter_array[i].address)) + " Wei");
    console.log(voter_array[i].address + " has " + (await votetoken.methods.balanceOf(voter_array[i].address).call()) + " Tokens");
  }

  console.log("The admin " + senderAccount + " has " + (await votetoken.methods.balanceOf(senderAccount).call()) + " Tokens left (should be 0)");

  console.log("Registration over at block " + (await web3.eth.getBlockNumber()) + ". Continue with commitments at " + endRegistrationPhaseBlocknr);


  if(netId == "1337") // Ganache
    await advanceToNextPhase(web3, parseInt(endRegistrationPhaseBlocknr));

  while(parseInt(await web3.eth.getBlockNumber()) < parseInt(endRegistrationPhaseBlocknr)) {
    console.log("Waiting for block " + endRegistrationPhaseBlocknr + " (now at " + (await web3.eth.getBlockNumber()) + ")");
    await sleep(2000);
  }


  let noteArray = []; // new Array(parseInt(process.env.INITIAL_SUPPLY));
  let commitArray = []; // = new Array(parseInt(process.env.INITIAL_SUPPLY));
  
  console.log("------------ Starting Commit Round ----------------");
  console.log("Current Blocknr, ", await web3.eth.getBlockNumber());

  for(var i = 0; i < voter_array.length; i++) {
    var voterAddress = voter_array[i].address;

    const deposit = createDeposit({ nullifier: rbigint(31), secret: rbigint(31)});
    const note = toHex(deposit.preimage, 62);

    const noteString = `tornado-vote-${votetoken._address}-${netId}-${note}`;

    const allowance = await voteToken.methods.allowance(senderAccount, tornado._address).call({ from: voterAddress });
    console.log("Current allowance", allowance);

    console.log("Approving token for deposit");
    await voteToken.methods.approve(tornado._address, 1).send({from: voterAddress, gas: 1e6 })
      .on("receipt", (receipt) => {
        gas_approve = [...gas_approve, receipt.gasUsed];
      })
      .on("error", function (e) {
        console.error("on transactionHash error", e.message)
      }
    );

    console.log("New allowance", await voteToken.methods.allowance(voterAddress, tornado._address).call({ from: voterAddress }));

    console.log("Submitting deposit transaction")
    let fee = process.env.FEE;

    console.log("Fee", fee)
    let value = (toWei((process.env.FEE)) * 2).toString();

    console.log("Value is: ", fromWei(value));

    var res = await tornado.methods.deposit(toHex(deposit.commitment)).send({value: value, from: voterAddress, gas: 2e6 })
      .on("receipt", (receipt) => {
        gas_deposit = [...gas_deposit, receipt.gasUsed];
      }).on("error", function (e) {
        console.error("on transactionHash error", e.message)
      }
    );

    noteArray = [...noteArray, noteString];
  }
  console.log("Notes are: ", noteArray)

  // Account 0 simulates the relayer
  relayerAccount = (await web3.eth.getAccounts())[0];

  for(var i = 0; i < voter_array.length; i++) {
    var voterAddress = voter_array[i].address;

    console.log("Committing Account ", voterAddress);

    let { netId, deposit } = parseNote(noteArray[i]);

    var vote_commitment_secret = rbigint(31);
    var vote_choice = new Uint8Array(1);
    vote_choice[0] = i == 0 ? 0 : 1; // 0 == no, 1 == yes
    var inst_arr = Buffer.from(vote_choice.buffer);
    var buf_t = Buffer.concat([vote_commitment_secret.leInt2Buff(31), inst_arr], 32);
    var vote_commitment_hash = Web3.utils.sha3(buf_t);
    var buf = Buffer.from(web3.utils.hexToBytes(vote_commitment_hash));

    console.log("Vote_commitment_secret", web3.utils.bytesToHex(buf_t));

    let slice = buf.slice(0, 20);
    vote_commitment_hash = web3.utils.bytesToHex(slice);

    recipient = vote_commitment_hash;
    const { proof, args } = await generateProof({ deposit, recipient, relayerAccount });

    console.log(proof);
    console.log(args);
   
    let x = await tornado.methods.commit(proof, ...args).send({ from: relayerAccount, value: 0, gas: 1e6 })
      .on("receipt", (receipt) => {
        gas_commit = [...gas_commit, receipt.gasUsed];
      }).on("error", function (e) {
        console.error("on transactionHash error", e.message)
      });

    console.log("Secret ", web3.utils.bytesToHex(buf_t));
    commitArray = [...commitArray, web3.utils.bytesToHex(buf_t)];
  }

  if(netId == "1337") // Ganache
    await advanceToNextPhase(web3, parseInt(endCommitPhaseBlocknr));

  while(parseInt(await web3.eth.getBlockNumber()) < parseInt(endCommitPhaseBlocknr)) {
    console.log("Waiting for block " + endCommitPhaseBlocknr + " (now at " + (await web3.eth.getBlockNumber()) + ")");
    await sleep(2000);
  }

  console.log("------------ Starting Cast Round ----------------")
  console.log("The number of Yes votes are: ", (await votetoken.methods.balanceOf(YES_ADDRESS).call()) + " (should be 0)");
  console.log("The number of No votes are: ",  (await votetoken.methods.balanceOf(NO_ADDRESS).call()) + " (should be 0)");

  for(var i = 0; i < voter_array.length; i++) {
    console.log("Casting Account ", relayerAccount);

    let { netId, deposit } = parseNote(noteArray[i]);
    let vote_commitment_secret = commitArray[i];

    console.log("Submitting secret", commitArray[i]);

    let hash_secret = Buffer.from(web3.utils.hexToBytes(vote_commitment_secret));
    
    const args = [ //   function vote(address payable _recipient, bytes calldata _randomness, address payable _relayer, uint256 _fee, uint256 _refund) external payable nonReentrant {
      toHex(bigInt("0xB4F5663773fB2842d1A74B2da0b5ec95f2ac125A", "hex"), 20), // yes address
      hash_secret,
      toHex(bigInt(relayerAccount, "hex"), 20),
      toHex(bigInt("0")),
      toHex(bigInt("0"))
    ];
    
    console.log("Casting vote", relayerAccount);

    await tornado.methods.vote(...args).send({ from: relayerAccount, value: "0", gas: 1e6 })
      .on("receipt", (receipt) => {
        gas_vote = [...gas_vote, receipt.gasUsed];
      }).on("error", function (e) {
        console.error("on transactionHash error", e.message);
      });
  }

  console.log("\n------------ All votes are cast ----------------");
  console.log("The number of Yes votes are: ", (await votetoken.methods.balanceOf(YES_ADDRESS).call()));
  console.log("The number of No votes are: ",  (await votetoken.methods.balanceOf(NO_ADDRESS).call()));

  const mean = (arr) => {
    let sort = [...arr];
    arr.sort();
    return sort[parseInt(sort.length / 2)];
  };

  const sd = (arr) => {
    const _mean = mean(arr);

    let sum = 0;
    for(var i = 0; i < arr.length; i++)
      sum += Math.pow(arr[0] - _mean, 2);

    return parseInt(Math.round(Math.sqrt(sum / (arr.length - 1)), 0));
  };

  const min = (arr) => {
    let sort = [...arr];
    arr.sort();
    return arr[0];
  };

  const max = (arr) => {
    let sort = [...arr];
    arr.sort();
    return arr[arr.length - 1];
  };

  const gas = {
    gas_register,
    gas_register_min: min(gas_register),
    gas_register_max: max(gas_register),
    gas_register_sum: gas_register.reduce((l, r) => l + r),
    gas_register_mean: mean(gas_register),
    gas_register_sd: sd(gas_register),
    gas_approve,
    gas_approve_min: min(gas_approve),
    gas_approve_max: max(gas_approve),
    gas_approve_sum: gas_approve.reduce((l, r) => l + r),
    gas_approve_mean: mean(gas_approve),
    gas_approve_sd: sd(gas_approve),
    gas_deposit,
    gas_deposit_min: min(gas_deposit),
    gas_deposit_max: max(gas_deposit),
    gas_deposit_sum: gas_deposit.reduce((l, r) => l + r),
    gas_deposit_mean: mean(gas_deposit),
    gas_deposit_sd: sd(gas_deposit),
    gas_commit,
    gas_commit_min: min(gas_commit),
    gas_commit_max: max(gas_commit),
    gas_commit_sum: gas_commit.reduce((l, r) => l + r),
    gas_commit_mean: mean(gas_commit),
    gas_commit_sd: sd(gas_commit),
    gas_vote,
    gas_vote_min: min(gas_vote),
    gas_vote_max: max(gas_vote),
    gas_vote_sum: gas_vote.reduce((l, r) => l + r),
    gas_vote_mean: mean(gas_vote),
    gas_vote_sd: sd(gas_vote),
  };

  console.log(JSON.stringify(gas, null, 2));

  process.exit(0);
}


main()
