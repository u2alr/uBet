# Results: PREREG_MODEL_V2 (development folds A and B; fold F deliberately not run)

Paired difference in per-row negative-binomial log score versus the production model `m2` (positive = candidate better), rotation players,
95% week-block bootstrap CI. Numbers copied from `research/out/improve_model_dev.json`.

| fold | stat | C1 drift | C2 head-to-head | C3 both |
|---|---|---|---|---|
| A | pts | +0.0013 [+0.0001, +0.0024] | +0.0019 [+0.0001, +0.0036] | +0.0036 [+0.0013, +0.0057] |
| A | reb | +0.0058 [+0.0034, +0.0082] | +0.0030 [+0.0019, +0.0042] | +0.0077 [+0.0054, +0.0102] |
| A | ast | +0.0004 [-0.0003, +0.0014] | +0.0014 [-0.0000, +0.0028] | +0.0020 [+0.0002, +0.0039] |
| A | 3pm | +0.0058 [+0.0040, +0.0077] | +0.0001 [-0.0012, +0.0013] | +0.0053 [+0.0031, +0.0074] |
| B | pts | +0.0002 [-0.0003, +0.0006] | +0.0010 [-0.0004, +0.0024] | +0.0011 [-0.0004, +0.0026] |
| B | reb | +0.0001 [-0.0004, +0.0006] | +0.0002 [-0.0011, +0.0013] | +0.0002 [-0.0013, +0.0015] |
| B | ast | +0.0001 [-0.0004, +0.0005] | +0.0006 [-0.0006, +0.0018] | +0.0007 [-0.0006, +0.0020] |
| B | 3pm | -0.0000 [-0.0003, +0.0003] | -0.0007 [-0.0016, +0.0003] | -0.0007 [-0.0016, +0.0003] |

## Decision (by the rule fixed in advance)
**Nothing is adopted.** The rule needed a CI above 0 on at least 3 of 4 stats in BOTH folds. Fold A (one training season) shows real gains,
mostly from the drift correction, which is consistent with the diagnostics: with little training data the model is off by several percent and a
rolling correction helps. Fold B (two training seasons) shows no gain in any stat, every CI includes 0, and threes is slightly negative for the
head-to-head features. Because no candidate qualified, fold F (2025-26) was not run: the pre-registration reserves it for confirming an adopted
candidate, and running it anyway would only add a comparison to pick from.

## What this means
- The production model is not obviously leaving accuracy on the table once it has two or more seasons of training data.
- The Under lean on points and assists is mostly season-to-season drift (assists were 7% higher than the older seasons implied in 2025-26), not a fixable constant.
  The drift correction would address exactly that, and the 2025-26 evidence for it was not tested. It is the best candidate if the lean persists in the forward record.
- Head-to-head history carries almost no extra signal beyond what the model already sees. It is useful for people reading the page, not for the probabilities.
- None of this involves a sportsbook line. Better accuracy against naive baselines is not an edge over the market.

## PRA calibration (PREREG_CALIBRATION.md, Amendment B; `research/calibrate_pra.py`)
The PRA projection was calibrated once under the pre-registered gates. Method chosen: identity (nothing beat the raw model on fold B).
Fold B: slope 0.895, ECE 0.0277 (passes). Final season 2025-26: slope 0.837 (below 0.85) and ECE 0.0353 (above 0.03), so **PRA is `unvalidated`**
and stays research-only in the Chief. Same pattern as points and assists: the model's PRA lean toward Under is not stable between seasons.
The other four entries in `shared/calibration.json` are unchanged (checked entry by entry); only the artifact hash and version changed.
