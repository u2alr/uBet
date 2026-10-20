-- Each leg remembers which game it was for and when it tips off, so bets can be laid out by schedule.
ALTER TABLE mind_legs ADD COLUMN tip_off TEXT;       -- UTC, ISO 8601
ALTER TABLE mind_legs ADD COLUMN home_team TEXT;     -- full name, as the odds feed spells it
ALTER TABLE mind_legs ADD COLUMN away_team TEXT;
CREATE INDEX IF NOT EXISTS idx_mind_legs_tip ON mind_legs(tip_off);
