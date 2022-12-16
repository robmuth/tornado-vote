UPDATE gaseval SET blocks15 = MAX(round((58116 * votes) / 15000000 + 0.5, 0) + round(((44013+1017848) * votes) / 15000000 + 0.5, 0) + round((360106 * votes) / 15000000 + 0.5, 0) + round((49981 * votes) / 15000000 + 0.5, 0), ( SELECT MAX(number) FROM blocks ) - ( SELECT MAX(number) FROM blocks WHERE gas_free15_sum > gas ));
UPDATE gaseval SET blocks30 = MAX(round((58116 * votes) / 30000000 + 0.5, 0) + round(((44013+1017848) * votes) / 30000000 + 0.5, 0) + round((360106 * votes) / 30000000 + 0.5, 0) + round((49981 * votes) / 30000000 + 0.5, 0), ( SELECT MAX(number) FROM blocks ) - ( SELECT MAX(number) FROM blocks WHERE gas_free30_sum > gas ));

UPDATE blocks SET gas_used15 = MAX(gas_used, 15000000) WHERE gas_free15_sum < 100000 * (58116 + (44013+1017848) + 360106 + 49981);
SELECT COUNT(*) FROM blocks WHERE gas_free15_sum < 100000 * (58116 + (44013+1017848) + 360106 + 49981);

UPDATE blocks SET gas_used30 = MAX(gas_used, 30000000) WHERE gas_free30_sum < 100000 * (58116 + (44013+1017848) + 360106 + 49981);
SELECT COUNT(*) FROM blocks WHERE gas_free30_sum < 100000 * (58116 + (44013+1017848) + 360106 + 49981);


--UPDATE gaseval SET block15min = 