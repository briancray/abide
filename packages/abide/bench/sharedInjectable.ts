import { runShared } from './sharedRun.ts'

;(
    globalThis as unknown as { __SHARED_BENCH__: typeof runShared }
).__SHARED_BENCH__ = runShared
