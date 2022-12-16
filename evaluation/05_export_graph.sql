.mode csv
.output ../eval.csv
select votes, blocks15, blocks30 FROM gaseval where votes < 1000 and votes > 0 UNION select votes, MAX(blocks15), MAX(blocks30) FROM gaseval where votes >= 1000 AND votes % 100 = 0 group by votes ORDER BY votes ASC;
.output stdout
.mode column
