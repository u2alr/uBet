// Immutable pregame snapshot: the exact inputs, configuration and calibration identity of one Chief run.
// Replaying a snapshot through `decide` must reproduce the stored decision byte for byte.
import { decide, type Decision } from './minds.ts'
import type { Pick } from './picks.ts'
import type { CalibrationArtifact } from './engine/calibration.ts'
import { makeConfig, stableHash, type EngineConfig } from './engine/config.ts'

export interface RunSnapshot {
  version: string
  now: number
  injuryChecked: boolean
  config: EngineConfig
  configHash: string
  calibration: CalibrationArtifact | null
  calibrationHash: string | null
  picks: Pick[]
}

export function takeSnapshot(picks: Pick[], o: { version: string; now: number; injuryChecked: boolean; config: EngineConfig; calibration: CalibrationArtifact | null }): RunSnapshot {
  return {
    version: o.version, now: o.now, injuryChecked: o.injuryChecked, config: o.config, configHash: stableHash(o.config),
    calibration: o.calibration, calibrationHash: o.calibration?.hash ?? null, picks: JSON.parse(JSON.stringify(picks)),
  }
}

/** Serialise and revive: the round trip is what the database stores. */
export const serialize = (s: RunSnapshot): string => JSON.stringify(s)
export function revive(text: string): RunSnapshot {
  const s = JSON.parse(text) as RunSnapshot
  if (stableHash(s.config) !== s.configHash) throw new Error('snapshot config does not match its hash')
  s.config = makeConfig(s.config as never)
  return s
}

export function replay(s: RunSnapshot): Decision {
  return decide(s.picks, { now: s.now, config: s.config, calibration: s.calibration, injuryChecked: s.injuryChecked })
}
