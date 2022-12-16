UPDATE gaseval SET
	gas15 = MAX(58116 * votes, 15000000) + MAX((44013+1017848) * votes, 15000000) + MAX(360106 * votes, 15000000) + MAX(49981 * votes, 15000000),
	gas30 = MAX(58116 * votes, 30000000) + MAX((44013+1017848) * votes, 30000000) + MAX(360106 * votes, 30000000) + MAX(49981 * votes, 30000000);

CREATE INDEX index_gas_free15_sum ON blocks(gas_free15_sum);
CREATE INDEX index_gas_free30_sum ON blocks(gas_free30_sum);