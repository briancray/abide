import type { BuildOutput } from 'bun'
import { abideLog } from './abideLog.ts'

/*
On a failed Bun.build(), logs each diagnostic and exits non-zero. The one-shot
build entrypoints reach it through `buildArtifact` (build-or-die); the
incremental client build (build.ts) calls it directly on its conditional-exit
path. One reporter so build failure can't drift between them.
*/
export function exitOnBuildFailure(result: BuildOutput): void {
    if (result.success) {
        return
    }
    result.logs.forEach((entry) => {
        abideLog.error(entry)
    })
    process.exit(1)
}
