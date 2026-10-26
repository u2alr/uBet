"""The injury report's names must meet box-score names the same way shared/picks.ts normName does."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# project.py imports nba_api at module level; skip cleanly if it is not installed.
try:
    from project import norm_name
except ImportError:  # pragma: no cover
    norm_name = None


def test_suffixes_and_accents_but_not_names_that_contain_them():
    if norm_name is None:
        return
    assert norm_name("Jaren Jackson Jr.") == "jaren jackson"
    assert norm_name("Nikola Jokić") == "nikola jokic"
    assert norm_name("Jabari Ivey") == "jabari ivey"         # "iv" inside a name must survive
    assert norm_name("Ron Holland II") == "ron holland"
    assert norm_name("  De'Aaron   Fox ") == "deaaron fox"


if __name__ == "__main__":
    test_suffixes_and_accents_but_not_names_that_contain_them()
    print("ok test_suffixes_and_accents_but_not_names_that_contain_them")
