// TheSportsDB free tier (public key 123) as a backup schedule when ESPN's scoreboard is down. Upcoming games only: the free feed carries no live scores,
// so a game from here is always shown as not started. Pure parsing; names are the full team names the rest of the app already uses.

export interface FallbackGame {
  id: string; date: string; status: string; state: 'pre'
  home: { abbr: string; name: string; score: string }; away: { abbr: string; name: string; score: string }
}

export function parseSportsDbEvents(feed: any, abbrOf: (teamName: string) => string | undefined): FallbackGame[] {
  const out: FallbackGame[] = []
  for (const e of feed?.events ?? []) {
    const ts = typeof e?.strTimestamp === 'string' ? Date.parse(`${e.strTimestamp}Z`) : NaN   // the feed's timestamps are UTC
    const home = abbrOf(String(e?.strHomeTeam ?? '')), away = abbrOf(String(e?.strAwayTeam ?? ''))
    if (!Number.isFinite(ts) || !home || !away || !e.idEvent) continue
    out.push({ id: `sdb_${e.idEvent}`, date: new Date(ts).toISOString(), status: 'Scheduled', state: 'pre',
      home: { abbr: home, name: String(e.strHomeTeam), score: '0' }, away: { abbr: away, name: String(e.strAwayTeam), score: '0' } })
  }
  return out
}
