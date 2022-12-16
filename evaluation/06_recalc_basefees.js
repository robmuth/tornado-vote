const fs = require("fs");

var csv = fs.readFileSync("recalc15.csv", "utf8");
var lines = csv.split("\r\n");

var header = lines[0].split(",");

var blocks = {};
var min = -1, max = -1;

// Read blocks
for(var i = 1; i < lines.length; i++) {
	var line = lines[i].split(",");
	
	if(line.length < 3) // skip empty lines
		continue;
		
	var row = {};
	
	for(var j = 0; j < header.length; j++)
		row[header[j]] = line[j];
	
	var rowNumber = parseInt(row.number);
	
	if(min == -1 || min > rowNumber)
		min = rowNumber;
	if(max == -1 || max < rowNumber)
		max = rowNumber;
	
	blocks[row.number] = row;
}

console.log("Read " + Object.keys(blocks).length + " blocks");
console.log("Min block: " + min);
console.log("Max block: " + max);
console.log("Diff: " + (Object.keys(blocks).length - 1 - (max - min)));

const greatest = (l, r) => { return l > r ? l : r };

blocks[min].base_fee15_per_gas = parseInt(blocks[min].base_fee_per_gas);

var sql = "";

for(var i = min + 1; i <= max; i++) {
	var parent = blocks[i - 1];
	
	var parent_gas_target = parseInt(parseInt(parent.gas_limit) / 2);
	var parent_gas_limit = parseInt(parent.gas_limit);
	
	var parent_base_fee_per_gas = parseInt(parent.base_fee15_per_gas);
	var parent_gas_used = parseInt(parent.gas_used15);
	
	var expected_base_fee_per_gas = -1;
	
	if(parent_gas_used == parent_gas_target) {
		expected_base_fee_per_gas = parent_base_fee_per_gas;
	} else if(parent_gas_used > parent_gas_target) {
		let gas_used_delta = parent_gas_used - parent_gas_target;
		let base_fee_per_gas_delta = greatest(parseInt(parseInt((parent_base_fee_per_gas * gas_used_delta) / parent_gas_target) / 8), 1);
		expected_base_fee_per_gas = parent_base_fee_per_gas + base_fee_per_gas_delta;
	
		console.log("parent_gas_used " + parent_gas_used + " parent_gas_target " + parent_gas_target);
		console.log("Increase by " + expected_base_fee_per_gas * 100 / parent_base_fee_per_gas);
	} else {
		let gas_used_delta = parent_gas_target - parent_gas_used;
		let base_fee_per_gas_delta = parseInt(parseInt((parent_base_fee_per_gas * gas_used_delta) / parent_gas_target) / 8);
		expected_base_fee_per_gas = parent_base_fee_per_gas - base_fee_per_gas_delta;
		
		console.log("Decrease by " + expected_base_fee_per_gas * 100 / parent_base_fee_per_gas);
	}
	
	blocks[i].base_fee15_per_gas = expected_base_fee_per_gas;
	
	sql += "UPDATE blocks SET base_fee15_per_gas = " + expected_base_fee_per_gas + " WHERE number = " + i + ";\r\n";
}

fs.writeFileSync("recalc15.sql", sql, "utf8");
