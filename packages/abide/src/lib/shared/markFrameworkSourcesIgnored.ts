import type { SourceMap } from './types/SourceMap.ts'

/*
The path fragment that identifies abide's own framework sources in a source map.
The mount stack's "wall" — `scope`, `withScope`, `mountRange`, `runNode`,
`createEffectNode`, … — all live under the package's `src/lib/`; an author's
`.abide`/`.ts` frames never do. Matched as the contiguous directory + lib path
(not the npm name `@abide/abide`, which differs from the on-disk dir `abide`), so
it holds across the monorepo (`packages/abide/src/lib/`) and an install
(`node_modules/@abide/abide/src/lib/`) alike, while a user app dir like
`my-abide-app/src/lib/` does not match.

DERIVED from THIS module's own location (`…/<pkgDir>/src/lib/shared/…`) rather than
hardcoded, so it tracks a package-dir rename instead of silently going stale (an
empty ignore-list = the mount-stack wall reappears, which no test would catch). Falls
back to the literal if the expected `/src/lib/` layout is ever absent.
*/
const FRAMEWORK_LIB_PATH = ((): string => {
    const LIB_MARKER = '/src/lib/'
    const here = new URL(import.meta.url).pathname
    const libIndex = here.indexOf(LIB_MARKER)
    if (libIndex === -1) {
        return 'abide/src/lib/'
    }
    const beforeLib = here.slice(0, libIndex)
    const packageDir = beforeLib.slice(beforeLib.lastIndexOf('/') + 1)
    return `${packageDir}${LIB_MARKER}`
})()

/*
Marks every abide-framework source in a parsed source map as ignore-listed, so a
debugger collapses framework frames and a stack trace shows only authored ones —
the fix for the long mount-stack wall, applied without touching the runtime. Sets
both the standardized `ignoreList` and Chrome's legacy `x_google_ignoreList` for
the widest debugger support. Mutates and returns the same map.
*/
export function markFrameworkSourcesIgnored(map: SourceMap): SourceMap {
    const ignored = (map.sources ?? []).reduce<number[]>((indices, source, index) => {
        if (source !== null && source.includes(FRAMEWORK_LIB_PATH)) {
            indices.push(index)
        }
        return indices
    }, [])
    map.ignoreList = ignored
    map.x_google_ignoreList = ignored
    return map
}
