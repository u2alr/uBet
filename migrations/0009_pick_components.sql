-- Log the parts of each pick as well as the blended number, so the model/market blend can later be judged on
-- forward data: how good was the model alone, the market alone, and the mix? Non-destructive: new nullable columns.
ALTER TABLE predictions ADD COLUMN model_prob REAL;   -- model's chance of winning, given no refund
ALTER TABLE predictions ADD COLUMN market_prob REAL;  -- market's chance of winning with the margin removed (null if unavailable)
ALTER TABLE predictions ADD COLUMN push REAL;         -- chance of a refund (whole-number line)
