// `bun packages/harness/scripts/benchShared.ts` — the JSC arm of `sharedCases`.
import { formatShared, runShared } from './sharedRun.ts'

console.log(formatShared(runShared(10_000_000_000)))
