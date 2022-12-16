const fs = require("fs");

var csv = fs.readFileSync("../constantBaseFeePerGas.csv", "utf8");

var lines = csv.split("\n");

var header = lines[0].split(";");

var blocks = {};
var min = -1, max = -1;

const samples = 100;

// Read blocks
for(var i = 1; i < lines.length; i++) {
	var line = lines[i].split(";");
	
	if(line.length < 3) // skip empty lines
	continue;
	
	var row = { };
	
	for(var j = 0; j < header.length; j++)
		row[header[j]] = line[j];
	
	var rowNumber = parseInt(row.block);
	
	if(min == -1 || min > rowNumber)
		min = rowNumber;
	if(max == -1 || max < rowNumber)
		max = rowNumber;
		
	blocks[rowNumber] = row;
}

const avg = (arr) => {
	var sum = 0;
	for(var i = 0; i < arr.length; i++)
		sum += arr[i];
	return parseInt(sum / arr.length);
};


var out = "block;original_base_fee_per_gas;new_base_fee_per_gas;gas_used_for_votes_sum;fee_for_votes_sum;number;votes\n";

for(var i = max; i > 0; i -= samples) {
	var original_base_fee_per_gas = [];
	var new_base_fee_per_gas = [];
	var gas_used_for_votes_sum = -1;
	var fee_for_votes_sum = -1;

	for(var j = 0; j < samples; j++) {
		if(blocks[i - j]) {
			original_base_fee_per_gas.push(blocks[i - j].original_base_fee_per_gas / samples);
			new_base_fee_per_gas.push(blocks[i - j].new_base_fee_per_gas  / samples);
			
			gas_used_for_votes_sum = blocks[i - j].gas_used_for_votes_sum;
			fee_for_votes_sum = blocks[i - j].fee_for_votes_sum;
		}
	}
	
	if(new_base_fee_per_gas.length > 0) {
		out += 
			(i - min) + ";" +
			avg(original_base_fee_per_gas) * samples + ";" + 
			avg(new_base_fee_per_gas) * samples + ";" + 
			parseInt(gas_used_for_votes_sum) + ";" + 
			parseInt(fee_for_votes_sum) + ";" +
			(max - i) + ";" +
			parseInt(parseInt(gas_used_for_votes_sum) / (58116 + (44013+1017848) + 360106 + 49981)) + "\n";
	}
}

console.log(out);

fs.writeFileSync("../constantBaseFeePerGas_sum.csv", out);
