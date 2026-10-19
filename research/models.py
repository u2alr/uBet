"""Models under test. All take the point-in-time frame from features.py.

- b0   season-to-date mean (earlier seasons fill in while the season is young)
- b1   last-10 mean
- app  exact port of shared/baseline.ts (recency + game-type weights, Poisson/normal tail): what users see now
- m2   gradient boosting, Poisson loss, predicting the stat directly
- m3   gradient boosting, minutes model x per-minute-rate model (how a bettor decomposes a prop)

Counts are scored with a negative binomial whose dispersion is fitted on a held-back slice of the training
period, so every model's mean is judged under the same kind of distribution.
"""
import numpy as np
import pandas as pd
from scipy.stats import nbinom, norm, poisson
from sklearn.ensemble import HistGradientBoostingRegressor

from features import FEATURES, STATS

HGB = dict(max_iter=400, learning_rate=0.04, max_leaf_nodes=24, min_samples_leaf=200, l2_regularization=2.0,
           early_stopping=False, random_state=0)
RECENCY = 0.93
HISTORY = 80  # 0.93**80 < 0.3%, so older games carry no weight


# ---------- exact port of shared/baseline.ts ----------

def type_weight(is_playoff_hist: np.ndarray, upcoming_playoffs: bool) -> np.ndarray:
    reg = 0.7 if upcoming_playoffs else 1.0
    po = 1.2 if upcoming_playoffs else 0.6
    return np.where(is_playoff_hist, po, reg)


def app_stats(df: pd.DataFrame, stat: str) -> pd.DataFrame:
    """Weighted mean / spread of every prior game, per row. df must be sorted by date within player."""
    out = np.full((len(df), 4), np.nan)  # mean, spread, nEff, nPrior
    pos = 0
    for _, sub in df.groupby("PLAYER_ID", sort=False):
        x = sub[stat].to_numpy(float)
        po = sub.playoffs.to_numpy(bool)
        n = len(x)
        for t in range(n):
            lo = max(0, t - HISTORY)
            hist = x[lo:t][::-1]  # most recent first
            if len(hist) < 5:
                continue
            tw = type_weight(po[lo:t][::-1], bool(po[t]))
            w = tw * RECENCY ** np.arange(len(hist))
            sw = w.sum()
            mean = (w * hist).sum() / sw
            var = max((w * hist * hist).sum() / sw - mean * mean, 0.0)
            n_eff = sw * sw / (w * w).sum()
            spread = max(np.sqrt(var) * (1 + 1 / max(n_eff, 1)), 0.5)
            out[pos + t] = (mean, spread, n_eff, len(hist))
        pos += n
    return pd.DataFrame(out, columns=["mean", "spread", "n_eff", "n_hist"], index=df.index)


def app_p_over(mean: np.ndarray, spread: np.ndarray, line: np.ndarray) -> np.ndarray:
    """The app's native P(over): Poisson tail for means < 6, normal otherwise (as in predict())."""
    pois = 1 - poisson.cdf(np.floor(line), np.maximum(mean, 0.05))
    norm_ = 1 - norm.cdf((line - mean) / spread)
    return np.where(mean < 6, pois, norm_)


# ---------- negative binomial scoring ----------

class Dispersion:
    """alpha(mu) in Var = mu + alpha*mu^2, fitted by moments in mean-bins."""

    def fit(self, mu: np.ndarray, y: np.ndarray, bins: int = 10):
        ok = np.isfinite(mu) & np.isfinite(y)
        mu, y = mu[ok], y[ok]
        edges = np.unique(np.quantile(mu, np.linspace(0, 1, bins + 1)))
        idx = np.clip(np.searchsorted(edges, mu, side="right") - 1, 0, len(edges) - 2)
        centers, alphas = [], []
        for b in range(len(edges) - 1):
            m = idx == b
            if m.sum() < 50:
                continue
            a = (((y[m] - mu[m]) ** 2 - mu[m]).sum()) / (mu[m] ** 2).sum()
            centers.append(mu[m].mean())
            alphas.append(max(a, 1e-3))
        self.c, self.a = np.array(centers), np.array(alphas)
        return self

    def alpha(self, mu):
        return np.interp(mu, self.c, self.a)


def nb_logpmf(y, mu, alpha):
    mu = np.maximum(mu, 1e-3)
    r = 1.0 / alpha
    return nbinom.logpmf(y, r, r / (r + mu))


def nb_p_over(line, mu, alpha):
    mu = np.maximum(mu, 1e-3)
    r = 1.0 / alpha
    return nbinom.sf(np.floor(line), r, r / (r + mu))


# ---------- predictors ----------

def baseline_means(df: pd.DataFrame, stat: str) -> dict[str, np.ndarray]:
    s2d, n = df[f"{stat}_s2d"], df.n_prior_season
    l40 = df[f"{stat}_l40"]
    # Young season: lean on the longer history until ~10 games are in.
    l10 = df[f"{stat}_l10"]
    b0 = pd.Series(np.where(n >= 10, s2d, l40.fillna(s2d)), index=df.index).fillna(l10)
    return {"b0": b0.to_numpy(float), "b1": l10.to_numpy(float)}


def fit_minutes(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    m = HistGradientBoostingRegressor(loss="squared_error", **HGB).fit(train[FEATURES], train["minutes"])
    return np.clip(m.predict(test[FEATURES]), 0, 48)


def fit_predict_hgb(train: pd.DataFrame, test: pd.DataFrame, stat: str, mins_pred: np.ndarray) -> dict[str, np.ndarray]:
    X, Xt = train[FEATURES], test[FEATURES]
    m2 = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(X, train[stat])
    rate = HistGradientBoostingRegressor(loss="poisson", **HGB).fit(
        X, train[stat] / train["minutes"], sample_weight=train["minutes"]
    )
    return {"m2": m2.predict(Xt), "m3": mins_pred * rate.predict(Xt)}
