#!/usr/bin/env bash
. ~/.nvm/nvm.sh
. ~/.profile
. ~/.bashrc

DIR="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
RESULTS=$DIR/experiment_results_rob/
mkdir -p $RESULTS

cp .env .env_original

nvm use v12.0.0

echo "votes,timestamp,deployment,register_mean,register_min,register_max,register_sd,approve_mean,approve_min,approve_max,approve_sd,deposit_mean,deposit_min,deposit_max,deposit_sd,commit_mean,commit_min,commit_max,commit_sd,vote_mean,vote_min,vote_max,vote_sd" > $RESULTS/results.csv

input="$DIR/experiments.csv"
while IFS= read -r line
do
	if [[ "$line" != \#* ]]
	then
		INITIAL_SUPPLY=$(echo $line | cut -d ";" -f 1)
		EndRegistrationPhase=$(echo $line | cut -d ";" -f 2)
		EndCommitPhase=$(echo $line | cut -d ";" -f 3)
		EndVotingPhase=$(echo $line | cut -d ";" -f 4)
		echo "INITIAL_SUPPLY=$INITIAL_SUPPLY" >> .env
		echo "EndRegistrationPhase=$EndRegistrationPhase" >> .env
		echo "EndCommitPhase=$EndCommitPhase" >> .env
		echo "EndVotingPhase=$EndVotingPhase" >> .env

		screen -S ganache -d -m /bin/bash -c 'ganache-cli --mnemonic "sock work police cube fine clean early much picture scan foot sure" –networkId 1337'
		npm run migrate:dev | tee $RESULTS/${INITIAL_SUPPLY}_deployment.txt

		./experiment.js | tee $RESULTS/${INITIAL_SUPPLY}_experiment.txt

		screen -X -S ganache quit
		
		timestamp=$(date +%s)
		depl_gas=$(less $RESULTS/${INITIAL_SUPPLY}_deployment.txt | grep "gas used:" | tail -n 4 | sed -E "s/^.*:[\\t ]+//" | sed "s/ .*$//" | paste -sd+ | bc)
		
		register_mean=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep register_mean | sed 's/.*: //' | sed s/,$//)
		register_min=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep register_min | sed 's/.*: //' | sed s/,$//)
		register_max=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep register_max | sed 's/.*: //' | sed s/,$//)
		register_sd=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep register_sd | sed 's/.*: //' | sed s/,$//)
		
		approve_mean=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep approve_mean | sed 's/.*: //' | sed s/,$//)
		approve_min=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep approve_min | sed 's/.*: //' | sed s/,$//)
		approve_max=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep approve_max | sed 's/.*: //' | sed s/,$//)
		approve_sd=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep approve_sd | sed 's/.*: //' | sed s/,$//)
		
		deposit_mean=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep deposit_mean | sed 's/.*: //' | sed s/,$//)
		deposit_min=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep deposit_min | sed 's/.*: //' | sed s/,$//)
		deposit_max=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep deposit_max | sed 's/.*: //' | sed s/,$//)
		deposit_sd=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep deposit_sd | sed 's/.*: //' | sed s/,$//)
		
		commit_mean=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep commit_mean | sed 's/.*: //' | sed s/,$//)
		commit_min=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep commit_min | sed 's/.*: //' | sed s/,$//)
		commit_max=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep commit_max | sed 's/.*: //' | sed s/,$//)
		commit_sd=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep commit_sd | sed 's/.*: //' | sed s/,$//)
		
		vote_mean=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep vote_mean | sed 's/.*: //' | sed s/,$//)
		vote_min=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep vote_min | sed 's/.*: //' | sed s/,$//)
		vote_max=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep vote_max | sed 's/.*: //' | sed s/,$//)
		vote_sd=$(cat $RESULTS/${INITIAL_SUPPLY}_experiment.txt | grep vote_sd | sed 's/.*: //' | sed s/,$//)

		echo "$INITIAL_SUPPLY,$timestamp,$depl_gas,$register_mean,$register_min,$register_max,$register_sd,$approve_mean,$approve_min,$approve_max,$approve_sd,$deposit_mean,$deposit_min,$deposit_max,$deposit_sd,$commit_mean,$commit_min,$commit_max,$commit_sd,$vote_mean,$vote_min,$vote_max,$vote_sd" >> $RESULTS/results.csv
	fi
done < "$input"


