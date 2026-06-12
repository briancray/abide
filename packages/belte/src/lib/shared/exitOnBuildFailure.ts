import type { BuildOutput } from 'bun'
import { belteLog } from './belteLog.ts'

/*
On a failed Bun.build(), logs each diagnostic and exits non-zero. Every belte
build entrypoint (build / compile / buildCli / bundleApp) funnels its result
through here so failure reporting can't drift between them.
*/
export function exitOnBuildFailure(result: BuildOutput): void {
    if (result.success) {
        return
    }
    result.logs.forEach((entry) => {
        belteLog.error(entry)
    })
    process.exit(1)
}
