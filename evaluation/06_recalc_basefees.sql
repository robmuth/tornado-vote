SELECT 
    blocks.*,
    parent.number as parent_block,  
    CAST(parent.gas_limit / 2 AS INT) as parent_gas_target,
    --parent.base_fee_per_gas as parent_base_fee_per_gas,
    parent.gas_used as parent_gas_used,
    --(parent.gas_used - CAST(parent.gas_limit / 2 AS INT)) as gas_used_delta,
    --MAX(CAST(CAST(parent.base_fee_per_gas * (parent.gas_used - CAST(parent.gas_limit / 2 AS INT)) / CAST(parent.gas_limit / 2 AS INT) AS INT) / 8 AS INT), 1) as base_fee_per_gas_delta,
    parent.base_fee_per_gas as parent_base_fee_per_gas,
    parent.base_fee_per_gas + MAX(CAST(CAST(parent.base_fee_per_gas * (parent.gas_used - CAST(parent.gas_limit / 2 AS INT)) / CAST(parent.gas_limit / 2 AS INT) AS INT) / 8 AS INT), 1) as expected_base_fee_per_gas
FROM 
    blocks blocks 
    LEFT JOIN blocks parent 
    ON parent.number = (blocks.number - 1) 
WHERE 1=1
    AND blocks.number < (SELECT MIN(number) FROM blocks) + 1500
    AND parent_gas_used > parent_gas_target
    --AND blocks.gas_used15 IS NOT NULL
ORDER BY number DESC;

.mode csv
.output recalc15.csv
SELECT * FROM blocks WHERE blocks.gas_free15_sum < 100000 * (58116 + (44013+1017848) + 360106 + 49981) ORDER BY number ASC;
.output stdout
.output recalc30.csv
SELECT * FROM blocks WHERE blocks.gas_free30_sum < 100000 * (58116 + (44013+1017848) + 360106 + 49981) ORDER BY number ASC;
.output stdout
.mode column