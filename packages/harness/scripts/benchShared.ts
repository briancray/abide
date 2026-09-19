// `bun packages/harness/scripts/benchShared.ts` — the JSC arm of `sharedCases`.
import { printShared, runShared } from './sharedRun.ts'

console.log(printShared(runShared(10_000_000_000)))
