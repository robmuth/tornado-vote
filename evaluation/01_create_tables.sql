CREATE TABLE blocks (
	number INTEGER NOT NULL PRIMARY KEY,
	timestamp INTEGER NOT NULL,
	gas_limit INTEGER NOT NULL,
	gas_used INTEGER NOT NULL,
	base_fee_per_gas INTEGER NOT NULL,
	gas_free15 INTEGER NOT NULL,
	gas_free INTEGER NOT NULL,
	gas_free15_sum INTEGER NOT NULL,
	gas_free30_sum INTEGER NOT NULL,
	base_fee15_per_gas INTEGER,
	base_fee30_per_gas INTEGER
	gas_used15 INTEGER,
	gas_used30 INTEGER
);

CREATE TABLE gaseval (
	votes INTEGER NOT NULL PRIMARY KEY,
	gas INTEGER NOT NULL,
	blocks15 INTEGER,
	blocks30 INTEGER,
	fee15 INTEGER,
	fee30 INTEGER,
	gas15 INTEGER,
	gas30 INTEGER
);