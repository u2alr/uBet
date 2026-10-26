// The calibration artifact bundled with the code (written by research/calibrate.py and research/calibrate_pra.py). Parsed once and validated:
// a malformed file fails at import, loudly, instead of silently disabling calibration.
import raw from '../calibration.json' with { type: 'json' }
import { parseCalibration, type CalibrationArtifact } from './calibration.ts'

export const CALIBRATION: CalibrationArtifact = parseCalibration(raw)
