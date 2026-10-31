"""Defensive Matchup features (rules and definitions: PREREG_DEFENSE.md). Research-only: nothing in production imports this module.

`add_defense(df, players_raw, teams_raw, matchups)` takes the frame from features.build(), the raw player and team box scores and the per-game matchup table
(research/pull_matchups.py) and adds columns prefixed `df_`.

EVERY value for a game uses only games on EARLIER DATES. Cumulative state is stored per date INCLUDING that date and always read with merge_asof(allow_exact_matches=False),
so a game never sees itself or anything played the same day. Rates are shrunk toward a league mean that is itself computed only from earlier dates, and a defender with little
exposure is pulled toward that mean (10 possessions never rates anyone elite or terrible). Missing information stays NaN and is reported, never guessed.
"""
import numpy as np
import pandas as pd

K_POSS = 1500.0       # shrinkage weight for defender rates, in the matchup feed's partial-possession units (a starter accumulates about 50 to 80 per game)
K_OFF = 800.0         # shrinkage weight for the guarded player's own expected scoring rate, same units
K_DIRECT = 150.0      # possessions of direct history needed for the direct term to carry half the weight
MIN_GAMES = 3         # a team window with fewer games is missing
CLASSES = ["G", "F", "C", "U"]

TD_METRICS = {      # name: (numerator, denominator, shrinkage weight in denominator units)
    "ppp_adj": ("adj_pts", "poss_opp", 800.0),
    "p3a_rate": ("opp_fg3a", "poss_opp", 800.0),
    "p3_pct": ("opp_fg3m", "opp_fg3a", 100.0),
    "ftr": ("opp_fta", "opp_fga", 700.0),
    "oreb_share": ("opp_oreb", "reb_chances", 300.0),
    "ast_rate": ("opp_ast", "poss_opp", 800.0),
    "tov_rate": ("opp_tov", "poss_opp", 800.0),
}
TD = [f"df_td_{m}_{w}" for m in TD_METRICS for w in ("l10", "s2d")]
PD = ["df_pd_dpoe", "df_pd_foul", "df_pd_fg3a", "df_pd_versatility", "df_pd_blk_pm", "df_pd_stl_pm", "df_pd_expo"]
MU = ["df_mu_dpoe", "df_mu_foul", "df_mu_fg3a", "df_mu_herf", "df_mu_conf", "df_mu_direct"]
IX_TEAM = ["df_ix_fg3m_x_3pa", "df_ix_reb_x_oreb", "df_ix_ast_x_ast", "df_ix_pts_x_ftr"]
IX_MU = ["df_ix_pts_x_mu"]
GROUPS = {"TD": TD + IX_TEAM, "PD": PD, "MU": MU + IX_MU}
ALL = [c for cols in GROUPS.values() for c in cols]


def _prior_by_date(daily: pd.DataFrame) -> pd.DataFrame:
    """League totals over strictly EARLIER dates, indexed by date."""
    return daily.sort_index().cumsum().shift(1)


def _asof(left: pd.DataFrame, right: pd.DataFrame, by, on="date") -> pd.DataFrame:
    """Latest `right` state with date strictly before left's date (never the same day)."""
    left = left.sort_values(on)
    right = right.sort_values(on)
    return pd.merge_asof(left, right, on=on, by=by, allow_exact_matches=False, direction="backward")


def load_matchups(con, teams: pd.DataFrame) -> pd.DataFrame:
    m = pd.read_sql("SELECT * FROM matchups", con).drop_duplicates(["game_id", "off_id", "def_id"])
    m["GAME_ID"] = m.game_id.astype(int)
    m["date"] = pd.to_datetime(m.date)
    both = teams[["GAME_ID", "TEAM_ID"]].drop_duplicates()
    pair = both.merge(both, on="GAME_ID", suffixes=("", "_o"))
    pair = pair[pair.TEAM_ID != pair.TEAM_ID_o].rename(columns={"TEAM_ID": "off_team", "TEAM_ID_o": "def_team"})
    for c in ("off_team", "off_id", "def_id"):
        m[c] = m[c].astype("int64")
    m = m.merge(pair, on=["GAME_ID", "off_team"], how="left")
    m["cls"] = m.off_pos.fillna("").astype(str).str.strip().str[:1].where(lambda s: s.isin(["G", "F", "C"]), "U")
    return m.drop(columns=["game_id"])


# ---------------------------------------------------------------- team defence

def team_defense(teams: pd.DataFrame) -> pd.DataFrame:
    """One row per (GAME_ID, TEAM_ID) = the DEFENDING team, with its prior-only defensive profile before that game."""
    t = teams.copy()
    t["date"] = pd.to_datetime(t.GAME_DATE)
    t["poss"] = t.FGA + 0.44 * t.FTA + t.TOV - t.OREB
    t = t.drop_duplicates(["GAME_ID", "TEAM_ID"])
    o = t[["GAME_ID", "TEAM_ID", "PTS", "FGA", "FTA", "FG3A", "FG3M", "OREB", "DREB", "AST", "TOV", "poss"]].rename(
        columns={"TEAM_ID": "OPP", "PTS": "opp_pts", "FGA": "opp_fga", "FTA": "opp_fta", "FG3A": "opp_fg3a", "FG3M": "opp_fg3m", "OREB": "opp_oreb",
                 "DREB": "opp_dreb", "AST": "opp_ast", "TOV": "opp_tov", "poss": "poss_opp"})
    d = t[["GAME_ID", "TEAM_ID", "date", "DREB"]].merge(o, on="GAME_ID")
    d = d[d.TEAM_ID != d.OPP].copy()
    d["reb_chances"] = d.opp_oreb + d.DREB
    # Strength adjustment: points allowed minus what that offence normally scores per possession (its OWN prior rate, shrunk to the prior league rate).
    d = d.sort_values(["OPP", "date", "GAME_ID"])
    gb = d.groupby("OPP")
    d["cum_pts"], d["cum_poss"] = gb.opp_pts.cumsum() - d.opp_pts, gb.poss_opp.cumsum() - d.poss_opp
    daily = d.groupby("date")[["opp_pts", "poss_opp"]].sum()
    lg = _prior_by_date(daily)
    lg_rate = (lg.opp_pts / lg.poss_opp).rename("lg_ppp")
    d = d.merge(lg_rate, left_on="date", right_index=True, how="left")
    off_rate = (d.cum_pts + 1000 * d.lg_ppp) / (d.cum_poss + 1000)
    d["adj_pts"] = d.opp_pts - d.poss_opp * off_rate
    d = d.sort_values(["TEAM_ID", "date", "GAME_ID"]).reset_index(drop=True)
    d["season_key"] = d.GAME_ID.astype(str).str[:3]      # the NBA game id encodes the season (and the regular/playoff split is irrelevant here)
    out = d[["GAME_ID", "TEAM_ID", "date"]].copy()
    for name, (num, den, k) in TD_METRICS.items():
        daily = d.groupby("date")[[num, den]].sum()
        lgm = _prior_by_date(daily)
        rate = (lgm[num] / lgm[den]).rename("lg")
        x = d[["TEAM_ID", "season_key", "date", num, den]].merge(rate, left_on="date", right_index=True, how="left")
        for w, win in (("l10", 10), ("s2d", None)):
            if win:
                g = x.groupby("TEAM_ID")
                sn = g[num].transform(lambda s: s.shift(1).rolling(win, min_periods=MIN_GAMES).sum())
                sd = g[den].transform(lambda s: s.shift(1).rolling(win, min_periods=MIN_GAMES).sum())
            else:
                g = x.groupby(["TEAM_ID", "season_key"])
                n = g.cumcount()
                sn, sd = g[num].cumsum() - x[num], g[den].cumsum() - x[den]
                sn, sd = sn.where(n >= MIN_GAMES), sd.where(n >= MIN_GAMES)
            out[f"df_td_{name}_{w}"] = ((sn + k * x.lg) / (sd + k)).values
    return out.drop(columns="date")


# ---------------------------------------------------------------- individual defenders

def defender_state(m: pd.DataFrame, players: pd.DataFrame) -> pd.DataFrame:
    """Cumulative defensive state per (defender, date), INCLUDING that date. Read it with _asof() so only earlier dates are visible."""
    m = m.sort_values(["off_id", "date", "GAME_ID"]).copy()
    # Expected points for the guarded player: his own prior points per matchup possession, shrunk to the prior league rate.
    og = m.groupby(["off_id", "GAME_ID", "date"], as_index=False).agg(pts=("pts", "sum"), poss=("poss", "sum")).sort_values(["off_id", "date"])
    og["cp"] = og.groupby("off_id").pts.cumsum() - og.pts
    og["cq"] = og.groupby("off_id").poss.cumsum() - og.poss
    lg = _prior_by_date(m.groupby("date")[["pts", "poss"]].sum())
    og = og.merge((lg.pts / lg.poss).rename("lg"), left_on="date", right_index=True, how="left")
    og["off_rate"] = (og.cp + K_OFF * og.lg) / (og.cq + K_OFF)
    m = m.merge(og[["off_id", "GAME_ID", "off_rate"]], on=["off_id", "GAME_ID"], how="left")
    m["dpoe"] = m.pts - m.poss * m.off_rate
    m = m[m.off_rate.notna()]
    for c in CLASSES:
        m[f"pos_{c}"] = np.where(m.cls == c, m.poss, 0.0)
    agg = m.groupby(["def_id", "GAME_ID", "date"], as_index=False)[["dpoe", "poss", "sfoul", "fg3a"] + [f"pos_{c}" for c in CLASSES]].sum().sort_values(["def_id", "date", "GAME_ID"])
    cols = ["dpoe", "poss", "sfoul", "fg3a"] + [f"pos_{c}" for c in CLASSES]
    for c in cols:
        agg[f"c_{c}"] = agg.groupby("def_id")[c].cumsum()
    # Blocks and steals per minute from the player's own box scores (secondary signals).
    pb = players.sort_values(["PLAYER_ID", "date"]).copy()
    for c in ("BLK", "STL", "min"):
        pb[f"c_{c}"] = pb.groupby("PLAYER_ID")[c].cumsum()
    pb = pb.groupby(["PLAYER_ID", "date"], as_index=False)[["c_BLK", "c_STL", "c_min"]].last().rename(columns={"PLAYER_ID": "def_id"})
    st = agg[["def_id", "date"] + [f"c_{c}" for c in cols]].groupby(["def_id", "date"], as_index=False).last()
    st = _asof_free_merge(st, pb)
    lgd = _prior_by_date(m.groupby("date")[["sfoul", "fg3a", "poss"]].sum())
    lgd = pd.DataFrame({"lg_foul": lgd.sfoul / lgd.poss, "lg_fg3a": lgd.fg3a / lgd.poss})
    st = st.merge(lgd, left_on="date", right_index=True, how="left")  # league rate as of the day BEFORE this state's date; slightly stale, never future
    return st


def _asof_free_merge(st: pd.DataFrame, pb: pd.DataFrame) -> pd.DataFrame:
    """Attach each defender's cumulative blocks/steals/minutes as of the same date (both are 'including this date' states)."""
    st = st.sort_values("date")
    pb = pb.sort_values("date")
    return pd.merge_asof(st, pb, on="date", by="def_id", allow_exact_matches=True, direction="backward")


def state_metrics(s: pd.DataFrame) -> pd.DataFrame:
    """Shrunk per-defender metrics from cumulative state columns."""
    s = s.copy()
    s["dpoe100"] = s.c_dpoe / (s.c_poss + K_POSS) * 100
    s["foul100"] = (s.c_sfoul + K_POSS * s.lg_foul) / (s.c_poss + K_POSS) * 100
    s["fg3a100"] = (s.c_fg3a + K_POSS * s.lg_fg3a) / (s.c_poss + K_POSS) * 100
    cls = s[[f"c_pos_{c}" for c in CLASSES]].to_numpy(float)
    p = (cls + 20 / 4) / (cls.sum(axis=1, keepdims=True) + 20)
    s["versatility"] = -(p * np.log(p)).sum(axis=1) / np.log(len(CLASSES))
    s["blk_pm"] = s.c_BLK / s.c_min.clip(lower=1)
    s["stl_pm"] = s.c_STL / s.c_min.clip(lower=1)
    s["expo"] = np.minimum(1.0, s.c_poss / K_POSS)
    return s


# ---------------------------------------------------------------- rotation

def rotation(players: pd.DataFrame, n_games: int = 10, min_appear: int = 3, min_avg: float = 10.0) -> pd.DataFrame:
    """For each (GAME_ID, TEAM_ID): the players who were in the team's rotation over its previous `n_games` games, weighted by average minutes when they played."""
    rows = []
    for team, tg in players.groupby("TEAM_ID"):
        games = tg.groupby("GAME_ID").date.first().sort_values().index.tolist()
        mins = tg.pivot_table(index="GAME_ID", columns="PLAYER_ID", values="min", aggfunc="sum").reindex(games)
        played = mins.notna() & (mins > 0)
        mins = mins.fillna(0.0)
        s = mins.shift(1).rolling(n_games, min_periods=1).sum()
        c = played.astype(float).shift(1).rolling(n_games, min_periods=1).sum()
        avg = (s / c.where(c > 0))
        keep = (c >= min_appear) & (avg >= min_avg)
        w = avg.where(keep)
        st = w.stack().rename("w").reset_index()
        st["TEAM_ID"] = team
        rows.append(st)
    r = pd.concat(rows, ignore_index=True)
    r = r.rename(columns={"PLAYER_ID": "def_id"})
    return r[["GAME_ID", "TEAM_ID", "def_id", "w"]]


# ---------------------------------------------------------------- assembling

def add_defense(df: pd.DataFrame, players_raw: pd.DataFrame, teams_raw: pd.DataFrame, m: pd.DataFrame, upcoming: pd.DataFrame | None = None, detail: bool = False):
    """`upcoming` (GAME_ID, TEAM_ID, GAME_DATE) lists games not yet played, so the same code computes the live context: their team and rotation rows are placeholders with no results,
    which the strictly-before windows never read. With detail=True also returns the per-defender assignment weights behind the matchup features: (frame, detail)."""
    df = df.copy()
    p = players_raw[players_raw.MIN > 0].copy()
    p["date"] = pd.to_datetime(p.GAME_DATE)
    p = p.rename(columns={"MIN": "min"})

    ph_teams = ph_players = None
    if upcoming is not None and len(upcoming):
        ph_teams = upcoming[["GAME_ID", "TEAM_ID", "GAME_DATE"]].copy()
        ph_players = ph_teams.assign(PLAYER_ID=-1, min=0.0, BLK=0.0, STL=0.0, date=pd.to_datetime(ph_teams.GAME_DATE))
        teams_raw = pd.concat([teams_raw, ph_teams], ignore_index=True)

    # TD: the opponent's defence.
    td = team_defense(teams_raw).rename(columns={"TEAM_ID": "OPP_ID"})
    df = df.merge(td, on=["GAME_ID", "OPP_ID"], how="left")

    if m.empty:   # no matchup data at all: team defence still works, individual and matchup features are recorded as missing
        for c in PD + MU + IX_MU:
            df[c] = np.nan
        df["df_ix_fg3m_x_3pa"] = df.fg3m_l10 * df.df_td_p3a_rate_l10
        df["df_ix_reb_x_oreb"] = df.reb_l10 * df.df_td_oreb_share_l10
        df["df_ix_ast_x_ast"] = df.ast_l10 * df.df_td_ast_rate_l10
        df["df_ix_pts_x_ftr"] = df.pts_l10 * df.df_td_ftr_l10
        return (df, pd.DataFrame()) if detail else df

    # Defender state and the opposing rotation.
    st = state_metrics(defender_state(m, p))
    pr = p if ph_players is None else pd.concat([p, ph_players[p.columns.intersection(ph_players.columns)]], ignore_index=True)
    rot = rotation(pr)
    rot = rot.merge(pr.groupby("GAME_ID").date.first().rename("date"), left_on="GAME_ID", right_index=True)
    rs = _asof(rot, st, by="def_id").rename(columns={"TEAM_ID": "OPP_ID"})
    rs["w"] = rs.w.astype(float)

    def wavg(frame, col, w="w"):
        ok = frame[col].notna()
        num = (frame[col].where(ok) * frame[w]).groupby([frame.GAME_ID, frame.OPP_ID]).sum()
        den = frame[w].where(ok).groupby([frame.GAME_ID, frame.OPP_ID]).sum()
        return (num / den.replace(0, np.nan)).rename(col)

    pd_tbl = pd.concat([wavg(rs, "dpoe100").rename("df_pd_dpoe"), wavg(rs, "foul100").rename("df_pd_foul"), wavg(rs, "fg3a100").rename("df_pd_fg3a"),
                        wavg(rs, "versatility").rename("df_pd_versatility"), wavg(rs, "blk_pm").rename("df_pd_blk_pm"), wavg(rs, "stl_pm").rename("df_pd_stl_pm"),
                        wavg(rs, "expo").rename("df_pd_expo")], axis=1).reset_index()
    df = df.merge(pd_tbl, on=["GAME_ID", "OPP_ID"], how="left")

    # MU: likely matchup for each (player, game), for rotation-level players.
    base = df[(df.n_prior >= 5) & (df.min_l10 >= 10)][["PLAYER_ID", "GAME_ID", "OPP_ID", "date"]].copy()
    x = base.merge(rs[["GAME_ID", "OPP_ID", "def_id", "w", "dpoe100", "foul100", "fg3a100", "expo", "c_pos_G", "c_pos_F", "c_pos_C", "c_pos_U"]], on=["GAME_ID", "OPP_ID"])
    # The guarded player's role class: his most recent earlier game's modal class.
    pc = m.groupby(["off_id", "date", "cls"], as_index=False).poss.sum().sort_values(["off_id", "date", "poss"]).groupby(["off_id", "date"], as_index=False).last()[["off_id", "date", "cls"]]
    pc = pc.rename(columns={"off_id": "PLAYER_ID", "cls": "role"})
    base = _asof(base, pc, by="PLAYER_ID")
    base["role"] = base.role.fillna("U")
    x = x.merge(base[["PLAYER_ID", "GAME_ID", "role"]], on=["PLAYER_ID", "GAME_ID"], how="left")
    # Direct history: his own possessions against each defender on earlier dates.
    pair = m.groupby(["off_id", "def_id", "date"], as_index=False).poss.sum().sort_values(["off_id", "def_id", "date"])
    pair["c_dir"] = pair.groupby(["off_id", "def_id"]).poss.cumsum()
    pair["key"] = pair.off_id.astype("int64") * 4_000_000 + pair.def_id.astype("int64")
    x["key"] = x.PLAYER_ID.astype("int64") * 4_000_000 + x.def_id.astype("int64")
    x = _asof(x, pair[["key", "date", "c_dir"]], by="key")
    x["c_dir"] = x.c_dir.fillna(0.0)
    x["role_poss"] = np.select([x.role == "G", x.role == "F", x.role == "C"], [x.c_pos_G, x.c_pos_F, x.c_pos_C], default=x.c_pos_U)
    x["role_poss"] = x.role_poss.fillna(0.0)
    keys = [x.PLAYER_ID, x.GAME_ID]
    tot_dir = x.groupby(keys).c_dir.transform("sum")
    tot_role = x.groupby(keys).role_poss.transform("sum")
    tot_w = x.groupby(keys).w.transform("sum")
    lam = tot_dir / (tot_dir + K_DIRECT)
    direct = (x.c_dir / tot_dir.replace(0, np.nan)).fillna(0.0)
    role = (x.role_poss / tot_role.replace(0, np.nan))
    role = role.fillna(x.w / tot_w.replace(0, np.nan))            # fallback: the rotation's minutes
    x["wt"] = lam * direct + (1 - lam) * role
    x["wt"] = x.wt / x.groupby(keys).wt.transform("sum").replace(0, np.nan)
    x["lam"] = lam

    def agg(col):
        ok = x[col].notna()
        return (x[col].where(ok) * x.wt).groupby(keys).sum() / x.wt.where(ok).groupby(keys).sum().replace(0, np.nan)

    mu = pd.DataFrame({"df_mu_dpoe": agg("dpoe100"), "df_mu_foul": agg("foul100"), "df_mu_fg3a": agg("fg3a100"),
                       "df_mu_herf": (x.wt ** 2).groupby(keys).sum(), "df_mu_conf": (x.wt * x.expo.fillna(0.0)).groupby(keys).sum(),
                       "df_mu_direct": x.groupby(keys).lam.first()}).reset_index()
    df = df.merge(mu, on=["PLAYER_ID", "GAME_ID"], how="left")

    # IX: offensive skill x defensive weakness, one per mechanism. Everything comes from existing prior-only features.
    df["df_ix_fg3m_x_3pa"] = df.fg3m_l10 * df.df_td_p3a_rate_l10
    df["df_ix_reb_x_oreb"] = df.reb_l10 * df.df_td_oreb_share_l10
    df["df_ix_ast_x_ast"] = df.ast_l10 * df.df_td_ast_rate_l10
    df["df_ix_pts_x_ftr"] = df.pts_l10 * df.df_td_ftr_l10
    df["df_ix_pts_x_mu"] = df.pts_l10 * df.df_mu_dpoe
    if detail:
        return df, x[["PLAYER_ID", "GAME_ID", "OPP_ID", "def_id", "wt", "dpoe100", "foul100", "fg3a100", "expo", "c_dir", "role"]].copy()
    return df
