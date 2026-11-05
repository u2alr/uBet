# What every number on the pages means

## Teams page

| You see | It means | It does **not** mean |
|---|---|---|
| **Our pick, 68%** | The chance we give the team to win: 30% our model, 70% the market's no-margin chance (just the model when no book has priced the game) | A guarantee, or that a bet on it is good value. We do not suggest bets |
| **Heavy / Clear / Slight / Toss-up** | How sure we are: heavy 78% and up, clear 65 to 78%, slight 56 to 65%, toss-up under 56% (`shared/seasonReview.ts` `TIER_MIN`) | Colour is about who is likelier to win, never about value |
| **Best price 1.77 DraftKings** | The highest decimal price any tracked book offers on that side. A price more than 15% above the runner-up is treated as stale and the runner-up is shown instead | A price you can necessarily get: lines move |
| **Market chance** | What the books' prices imply once each book's margin is removed (power method), combined by the median across books with one far-off book dropped | The truth: it is the market's opinion |
| **Model chance** | What our model says on its own, from ratings, rest and who is listed Out | Tested against prices. It has not been (yet) |
| **Spread / total** | The books' median lines, on half points | Our own forecast of margin or scoring: we have no validated model of either |
| **Our fair prices** | The prices that would carry no margin at our chance | An offer anyone will take |
| **Claude PHX, Lean / Pretty sure / Lock** | Claude's pre-game pick and how strongly it holds it, saved before tip-off | Part of any probability |
| **N out** | Players the NBA's report lists Out for this game (the same data as the Lineups tab) | Anyone ESPN or another feed mentions |

## Lineups tab

| You see | It means |
|---|---|
| **Five names with minutes** | The five players with the most minutes per game over the team's last 10 games, a game missed counting as zero. **Projected, not confirmed** |
| **OUT / DOUBT / QUES / PROB** | Exactly what the NBA's report lists for that player in that game (Out, Doubtful, Questionable, Probable). Not a chance of playing |
| **Played last game / Missed last 3 / last played Nov 2** | From our box scores: how many of the team's last 10 games he missed |
| **Next up** | The next three by minutes who are not listed Out or Doubtful: who steps in |
| **NBA injury report · updated Nov 5, 2:45 AM ET (14 min ago)** | The printed time of the report behind the flags and how old it is |
| **Not yet submitted to the NBA · default lineup** | The report says this team has not filed. Nothing is flagged; the projected five are shown as they are |
| **No one listed for this team** | The game is on the report and the team filed with nobody listed |
| **No NBA report for this game yet** | The newest stored report does not include the game (or there is no recent report). Nothing is flagged |

## Review tab

| You see | It means |
|---|---|
| **Favourite won N of M** | Of the finished games this season, how often the side the model had above 50% before tip actually won |
| **Stated vs actual by tier** | Whether "78% and up" teams won about 78% of the time; the **noise** column says how much a gap of that size could be luck at that sample size, and a tier "within noise" has not been shown to be wrong |
| **Log loss / Brier** | Standard scores for probability forecasts: lower is better. A coin flip scores 0.693 (log loss) and 0.25 (Brier) |
| **Claude's record** | How often Claude's picks won, and, for the verdict, only the games where Claude and the model picked different teams: it says "too early" until there are 50 of those |

## Health (`/api/health`, `npm run check:remote`)

Each line is a check with an age limit, and says what the pages do when it fails: game odds (12 hours), model numbers (36 hours), the NBA injury report (36 hours), box scores (72 hours in season), the keys and the tables the migrations create.
