CREATE TABLE etherscan_usd (
	date STRING,
	timestamp INTEGER,
	rate REAL
);

-- Calc median:
SELECT rate
FROM etherscan_usd
ORDER BY rate
LIMIT 1
OFFSET (SELECT COUNT(*) FROM etherscan_usd) / 2;