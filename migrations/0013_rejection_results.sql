-- Rejected candidates are graded too, so every filter can be audited: did the Skeptic's vetoes save money, or cost it?
ALTER TABLE mind_rejections ADD COLUMN game_date TEXT;
ALTER TABLE mind_rejections ADD COLUMN actual REAL;
ALTER TABLE mind_rejections ADD COLUMN result TEXT;     -- won | lost | push (as if it had been bet at the price shown)
