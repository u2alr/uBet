"""Remove the bookmaker's margin from decimal odds.

An honest market probability needs this: raw 1/odds sums to more than 1 because of the margin.
- proportional: scale all implied probabilities equally (what the app does today; simple, biased on longshots)
- power:        raise implied probabilities to a common power k >= 1 so they sum to 1
- shin:         Shin's model, which assumes some bettors are insiders (standard in sports-betting research)
Power and Shin shrink longshots more than favourites, matching the favourite-longshot bias seen in real markets.
"""
import numpy as np


def implied(odds) -> np.ndarray:
    return 1.0 / np.asarray(odds, float)


def proportional(odds) -> np.ndarray:
    q = implied(odds)
    return q / q.sum()


def power(odds) -> np.ndarray:
    q = implied(odds)
    if q.sum() <= 1:
        return q / q.sum()
    lo, hi = 1.0, 50.0
    for _ in range(100):
        k = (lo + hi) / 2
        if (q ** k).sum() > 1:
            lo = k
        else:
            hi = k
    p = q ** ((lo + hi) / 2)
    return p / p.sum()


def shin(odds) -> np.ndarray:
    q = implied(odds)
    big_q = q.sum()
    if big_q <= 1:
        return q / big_q

    def probs(z):
        return (np.sqrt(z * z + 4 * (1 - z) * q * q / big_q) - z) / (2 * (1 - z))

    lo, hi = 0.0, 0.999
    for _ in range(100):
        z = (lo + hi) / 2
        if probs(z).sum() > 1:
            lo = z
        else:
            hi = z
    p = probs((lo + hi) / 2)
    return p / p.sum()


METHODS = {"proportional": proportional, "power": power, "shin": shin}
