-- Logged suggestions record which calculation produced their numbers. Existing rows are left exactly as they were (they predate the
-- authoritative calculation and are labelled 'legacy' by default); new rows say 'authoritative' or 'legacy' and store the expected return shown.
ALTER TABLE predictions ADD COLUMN basis TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE predictions ADD COLUMN ev REAL;
