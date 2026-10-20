// A player name from the browser becomes a command-line argument for sync.py. argparse treats anything that starts
// with "-" as an option, and the old pattern allowed hyphens anywhere, so "--remote" passed and switched a local
// sync to production D1. A real name starts with a letter.
export const isSafePlayerName = (s) => typeof s === 'string' && /^\p{L}[\p{L}\p{M}.' -]{1,59}$/u.test(s)
