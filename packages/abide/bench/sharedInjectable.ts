import { type ArmsBench, runArms } from './armsRun.ts'
import { sharedCases } from './sharedCases.ts'

;(globalThis as unknown as { __SHARED_BENCH__: ArmsBench }).__SHARED_BENCH__ = (
    budget,
    sizing,
) => runArms(sharedCases(), budget, sizing)
