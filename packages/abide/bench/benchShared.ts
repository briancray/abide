// `bun run bench:shared` — the JSC arm of `sharedCases`.
import { formatArms, runArms } from './armsRun.ts'
import { sharedCases } from './sharedCases.ts'

console.log(formatArms(runArms(sharedCases(), 10_000_000_000)))
