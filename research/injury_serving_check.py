"""Train/serve check for the injury-report override in project.py. Read-only: writes only research/out/injury_serving_check.json.

    ingest/.venv/Scripts/python research/injury_serving_check.py

The model's `miss_prev` / `miss_prev2` features were TRAINED on one definition (rotation teammates absent from the previous game(s), from box
scores). project.py's opt-in override (`--injury-features`) SERVES a different one (minutes of rotation players listed Out). This script reports,
without inventing any evidence:
  1. the training distribution of the two features and the invariant miss_prev2 <= miss_prev that the training definition guarantees;
  2. what the override feeds the model on today's slate, and whether it respects that invariant;
  3. how far the projections move with the override on versus off (same model, same data, only the two features differ).
What it cannot do: say which projections are more ACCURATE. No historical injury reports exist, so the override cannot be backtested.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import project as P  # noqa: E402
from features import build, load_raw  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    players, teams = load_raw()
    games = P.upcoming_games(3)
    players, teams = P.add_placeholders(players, teams, games, P.current_rosters())
    base = build(players, teams)
    dummy = base.GAME_ID >= P.DUMMY_BASE
    hist = base[~dummy & base.miss_prev.notna()]

    report = {"training": {
        "rows": int(len(hist)),
        "miss_prev_percentiles": {str(q): float(hist.miss_prev.quantile(q / 100)) for q in (50, 75, 90, 99)},
        "share_miss_prev_zero": float((hist.miss_prev == 0).mean()),
        "share_miss_prev2_equal_miss_prev_when_positive": float(((hist.miss_prev2 == hist.miss_prev) & (hist.miss_prev > 0)).sum() / max((hist.miss_prev > 0).sum(), 1)),
        "invariant_miss_prev2_le_miss_prev_holds": bool((hist.miss_prev2 <= hist.miss_prev + 1e-9).all()),
    }}

    out_names = P.espn_out_players()
    df_off = P.drop_out_players(base.copy(), out_names)
    df_on = P.apply_injury_news(base.copy(), out_names)
    tgt_on = df_on[df_on.GAME_ID >= P.DUMMY_BASE]
    changed = tgt_on[(tgt_on.miss_prev > 0)]
    report["serving_override"] = {
        "teams_with_override": int(changed.TEAM_ID.nunique()),
        "override_miss_prev_percentiles": {str(q): float(changed.miss_prev.quantile(q / 100)) for q in (50, 75, 90, 99)} if len(changed) else {},
        "override_sets_miss_prev2_equal_to_miss_prev": bool((changed.miss_prev2 == changed.miss_prev).all()) if len(changed) else None,
        "share_above_training_p99": float((changed.miss_prev > report["training"]["miss_prev_percentiles"]["99"]).mean()) if len(changed) else None,
    }

    p_off = P.fit_and_project(df_off).set_index(["player_id", "stat"])["mean"]
    p_on = P.fit_and_project(df_on).set_index(["player_id", "stat"])["mean"]
    both = pd.concat([p_off.rename("off"), p_on.rename("on")], axis=1).dropna()
    both["delta"] = both.on - both.off
    both["rel"] = both.delta / both.off.clip(lower=0.5)
    per = {}
    for stat, g in both.groupby(level="stat"):
        per[stat] = {"players": int(len(g)), "mean_abs_change": float(g.delta.abs().mean()), "mean_abs_relative_change": float(g.rel.abs().mean()),
                     "share_up": float((g.delta > 0.05).mean()), "share_down": float((g.delta < -0.05).mean()), "max_abs_change": float(g.delta.abs().max())}
    report["projection_change_with_override"] = per
    OUT.mkdir(exist_ok=True)
    (OUT / "injury_serving_check.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
