const fs = require("fs");

var csv = "number,timestamp,gas_limit,gas_used,base_fee_per_gas,gas_free15,gas_free30,gas_free,gas_free15_sum,gas_free30_sum\n" + fs.readFileSync("blocks.csv", "utf8");
var lines = csv.split("\n");

var header = lines[0].split(",");

var blocks = {};
var min = -1, max = -1;

var baseFeesPerGas = [];

// Read blocks
for(var i = 1; i < lines.length; i++) {
	var line = lines[i].split(",");
	
	if(line.length < 3) // skip empty lines
		continue;
		
	var row = {
		cheap_gas: 0,
		cheap_gas_sum: 0,
		cheap_gas_fee: 0,
		cheap_gas_fee_sum: 0,
		original_base_fee_per_gas: 0
	};
	
	for(var j = 0; j < header.length; j++)
		row[header[j]] = line[j];
	
	var rowNumber = parseInt(row.number);
	
	if(min == -1 || min > rowNumber)
		min = rowNumber;
	if(max == -1 || max < rowNumber)
		max = rowNumber;
	
	baseFeesPerGas.push(parseInt(row.base_fee_per_gas));
	
	row["original_base_fee_per_gas"] = parseInt(row.base_fee_per_gas);
	
	blocks[row.number] = row;
}

baseFeesPerGas = baseFeesPerGas.sort();

console.log("Read " + Object.keys(blocks).length + " blocks");
console.log("Min block: " + min);
console.log("Max block: " + max);
console.log("Diff: " + (Object.keys(blocks).length - 1 - (max - min)));

console.log("Min base fee per gas: " + baseFeesPerGas[0]);
const medianBaseFeePerGas = baseFeesPerGas[parseInt(baseFeesPerGas.length / 2)];
console.log("Median base fee per gas: " + medianBaseFeePerGas);
console.log("Max base fee per gas: " + baseFeesPerGas[baseFeesPerGas.length - 1]);

//console.log(medianBaseFeePerGas - blocks[max].base_fee_per_gas);

const greatest = (l, r) => { return l > r ? l : r };

function estimateBaseFeePerGas(i) {
	var parent = blocks[i - 1];
	
	//console.log("parent " + parent);
	
	var parent_gas_target = parseInt(parseInt(parent.gas_limit) / 2);
	var parent_gas_limit = parseInt(parent.gas_limit);
	
	var parent_base_fee_per_gas = parseInt(parent.base_fee_per_gas);
	var parent_gas_used = parseInt(parent.gas_used);
	
	var expected_base_fee_per_gas = -1;
	
	
	if(parent_gas_used == parent_gas_target) {
		expected_base_fee_per_gas = parent_base_fee_per_gas;
	} else if(parent_gas_used > parent_gas_target) {
		let gas_used_delta = parent_gas_used - parent_gas_target;
		let base_fee_per_gas_delta = greatest(parseInt(parseInt((parent_base_fee_per_gas * gas_used_delta) / parent_gas_target) / 8), 1);
		expected_base_fee_per_gas = parent_base_fee_per_gas + base_fee_per_gas_delta;
	} else {
		let gas_used_delta = parent_gas_target - parent_gas_used;
		let base_fee_per_gas_delta = parseInt(parseInt((parent_base_fee_per_gas * gas_used_delta) / parent_gas_target) / 8);
		expected_base_fee_per_gas = parent_base_fee_per_gas - base_fee_per_gas_delta;
	}
	
	return expected_base_fee_per_gas;
}

for(var i = min + 1; i < max/*max + 1*/; i++) {
	const block = blocks[i];
	const parent = blocks[i - 1];
	
	if(!block || !parent)
		continue;
	
	if(parseInt(block.base_fee_per_gas) > medianBaseFeePerGas) {
		//console.log("Skip block " + i + " because it's to expensive");
	} else {
		//console.log("Block " + i + "is actually cheap enough.");
		
		if(parseInt(parent.gas_limit) - parseInt(parent.gas_used) > 0) {
			// console.log("... and the parent block " + (i - 1) + " has Gas left!! => Let's see how much, until medianBaseFeePerGas is reached");
			// console.log("... and the parent block " + (i - 1) + " has Gas left!! => Let's see how much, until medianBaseFeePerGas is reached");
			
			var originalParentGasUsed = parseInt(blocks[i - 1].gas_used);
			
			
			
			while(estimateBaseFeePerGas(i) < medianBaseFeePerGas) {
				//console.log(estimateBaseFeePerGas(i) + " < " + medianBaseFeePerGas + " ?");
				
				blocks[i - 1].gas_used = parseInt(blocks[i - 1].gas_used) + 10000;
			}
			
			var unusedGas = blocks[i - 1].gas_used - originalParentGasUsed;
			
			blocks[i].base_fee_per_gas = estimateBaseFeePerGas(i);
			
			if(unusedGas > 0) {
				blocks[i - 1].cheap_gas = unusedGas;
				blocks[i - 1].cheap_gas_fee = unusedGas * estimateBaseFeePerGas(i);
			}
		}
	}
}

for(var i = max - 1; i >= min; i--) {
	blocks[i].cheap_gas_sum = blocks[i].cheap_gas + blocks[i + 1].cheap_gas_sum;
	blocks[i].cheap_gas_fee_sum = blocks[i].cheap_gas_fee + blocks[i + 1].cheap_gas_fee_sum;
}

const gas10000 = 10000 * (58116 + (44013+1017848) + 360106 + 49981);

const outCsv = fs.createWriteStream("../constantBaseFeePerGas.csv");
outCsv.write("block;original_base_fee_per_gas;new_base_fee_per_gas;gas_used_for_votes_sum;fee_for_votes_sum\n");

for(let i = max; blocks[i].cheap_gas_sum < gas10000 && i >= min; i--) {
	//if(i == max || blocks[i].cheap_gas_sum != blocks[i - 1].cheap_gas_sum)
	outCsv.write(i + ";" + 
		blocks[i].original_base_fee_per_gas + ";" + 
		blocks[i].base_fee_per_gas + ";" +
		blocks[i].cheap_gas_sum + ";" + 
		blocks[i].cheap_gas_fee_sum + "\n");
}

//console.log(out);

//fs.writeFileSync("../constantBaseFeePerGas.csv", out, "utf8");


	