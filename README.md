# Tornado Vote: Anonymous Blockchain-based Voting

Tornado Vote is an anonymous and fair voting protocol, originally based on this [Master's Thesis](https://upcommons.upc.edu/handle/2117/364247?show=full) and [implementation](https://github.com/ananas-block/tornado-vote), supervised by [DSI](https://www.dsi.tu-berlin.de) at TU Berlin.
To this end, Tornado Vote builds on the non-custodial mixer [Tornado Cash](https://github.com/tornadocash/tornado-core) for Ethereum.

For more details, see the ICBC'23 paper (accepted and currently in publication):
[MT23] Robert Muth and Florian Tschorsch. "Tornado Vote: Anonymous Blockchain-based Voting." In: IEEE International Conference on Blockchain and Cryptocurrency, 2023

> Decentralized apps (DApps) often hold significant cryptocurrency assets. In order to manage these assets and coordinate joint investments, shareholders leverage the underlying smart contract functionality to realize a transparent, verifiable, and secure decision-making process. That is, DApps implement proposal-based voting. Permissionless blockchains, however, lead to a conflict between transparency and anonymity; potentially preventing free decision-making if individual votes and intermediate results become public. In this paper, we therefore present Tornado Vote, a voting DApp for anonymous, fair, and practical voting on the Ethereum blockchain. We propose to use a cryptocurrency mixer such as Tornado Cash to reconcile transparency and anonymity. To this end, we adapt Tornado Cash and develop a voting protocol that implements a fair voting process. While Tornado Vote can technically process 10 k votes on Ethereum in approximately two hours, this is not feasible under realistic conditions: Third-party transactions on the Ethereum Mainnet reduce the possible throughput, and transaction fees make it infeasible to use all available block capacities. We therefore present various Gas cost models that yield lower bounds and economic estimations with respect to the required number of blocks and voting costs to assess and adjust Tornado Vote's feasibility trade-off.


## Evaluation

Please be careful to run the test cases and evaluation scripts locally (not connected to the Ethereum Mainnet).

### Test cases: Casting a vote

The following test case casts a vote locally with [Ganache](https://trufflesuite.com/ganache/).
Therefore, the test case first commits to a vote and finally reveals the vote to be counted.

```
nvm use v14.0.0
npm run build:self
ganache-cli --mnemonic "sock work police cube fine clean early much picture scan foot sure" –networkId 1337 &
npm test ./test/VoteToken.test.js
```

### Gas Costs Experiments

All evaluation results from the paper are available in ```./experiments_results/``` and can be re-run once again with our experiments script.
The voting pararemters can be configured in ```./experiments.csv```.

```
nvm use v12.0.0
npm run build:self
ganache-cli --mnemonic "sock work police cube fine clean early much picture scan foot sure" –networkId 1337 &
./experiments.sh
```

### Gas Costs Models

The Gas costs model calculation results are available in a Sqlite database: ```./evaluation/eval.db``` (the file is zipped and split into 100MB chunks for Github, since LFS is not supported on forked repositories).
To generate the same database again, the numbered shell scripts in ```./evaluations/``` can be executed in order. The required historic data are also available:

- ```./evaluation/blocks.csv.zip``` Mainnet blocks dump from Google Bigquery (also split into chunks)
- ```./evaluation/export-EtherPrice.csv``` Historic exchange rated from Ether to USD from [Etherscan.io](https://etherscan.io)
