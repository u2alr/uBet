-- Version 5: leans are a second, smaller-stake tier, tracked apart from the strict bets.
ALTER TABLE mind_bets ADD COLUMN tier TEXT NOT NULL DEFAULT 'strict';   -- strict | lean | research
UPDATE mind_bets SET tier = 'research' WHERE research = 1;
