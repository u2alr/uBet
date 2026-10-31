# Injury report as a model input: what was checked, what can and cannot be concluded

## The mismatch (confirmed in `research/project.py`)
- **Trained on:** `miss_prev` / `miss_prev2` from `research/features.py _missing_rotation`: the summed typical minutes of rotation teammates who were absent from the
  previous one or two team games, measured from box scores. Always `miss_prev2 <= miss_prev`; 24% of training rows have `miss_prev == 0`; 99th percentile 180 minutes.
- **Served (opt-in only now):** `apply_injury_news` overwrote both features with the minutes of rotation players ESPN lists Out tonight. A different quantity
  (tonight's report, not recent absence), with different timing and different noise.

## What `research/injury_serving_check.py` measured (current slate, 25 teams with a listed-Out rotation player)
Output: `research/out/injury_serving_check.json`. Same model, same data; only the two features differ.
- Mean absolute projection change per player: points 0.13, rebounds 0.04, assists 0.03, threes 0.02, PRA 0.17 (about 1.5% to 2.2% relative).
- Direction: **more projections went down than up** for every stat (points 33% down vs 21% up; assists 16% vs 7%; PRA 30% vs 29%), although a missing
  rotation player is expected to raise teammates' usage. The model did not learn a usable positive response to these two features.
- 4% of the overridden rows are above the training 99th percentile of `miss_prev`.

## What cannot be concluded
Whether the override makes projections more or less ACCURATE. That needs historical injury reports aligned to game time, and **none exist in this repository**
(ESPN's feed is a current snapshot; nothing was archived). The pre-registered walk-forward procedure (`PREREG_MODEL_V2.md` folds A/B/F) can evaluate only the
definition the model was trained on, which is the version with the override removed. The "consistently defined feature" arm (the same quantity at train and
serve time, sourced from injury reports) cannot be built or evaluated without that archive. Nothing here estimates it.

## Decision (applied)
- `project.py` no longer changes any feature by default. `--injury-features` keeps the old behaviour as an explicit, labelled experiment.
- Players listed Out are still removed from the projection set (`drop_out_players`). That is availability filtering, not a modelling adjustment: other players'
  features use only earlier games, so removing a row changes nothing else.
- The earlier teammate-out lift (`PREREG_TEAMMATE_OUT.md`) was tested and rejected; it stays rejected.

## What would unlock a valid test
Archive the injury report with a timestamp before every game (see the point-in-time archive work in `functions/api/[[route]].ts` and `research/PREREG_MARKET.md`'s
data plan). After one season of archived reports, pre-register the comparison (override on vs off, same folds, same metrics) and run it once.


## Update: the game-winner view (PREREG_GAMES.md addendum)
For TEAM results the missing piece was not an archive: who actually sat out a game is recoverable from box scores for every historical game, so "rotation players not playing" is defined the same way
for training (box score) and serving (the report's Out list as of the snapshot). That feature (AVAIL2) passed both development seasons and the final season. It was validated with the actual absentees, which
is a best case for the live report; `injury_log` now records each report read so its accuracy can be measured. This does NOT change the player-prop decision above: for props the same-game absence is not
yet validated against props, and the serving mismatch described here still applies there.
