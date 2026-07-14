import { createShadowProgram, type ShadowProgram } from './createShadowProgram.ts'

/*
Get-or-build the warm shadow program for a project root, cached once per root and shared by
the interpolation and seed classifiers (whichever is requested first for a root warms it; the
other reuses it). The shadow program is what makes type-directed async detection possible —
resolving whether `{getFoo()}` is a promise/stream and lifting it to a streaming/blocking cell.

On a build FAILURE the program is cached as `undefined` and the classifiers degrade to today's
plain-value / syntactic behavior — the build never breaks. But the failure is WARNED once per
root: a silent `undefined` disables type-directed async detection for EVERY component in the
root, so a broken tsconfig would otherwise ship a bare `{getFoo()}` as the literal
`[object Promise]` text with no signal at all. The warn fires once (guarded by `cache.has`), so
the two classifiers sharing a cache never double-report.

`build` is injectable so the warn-once path is testable without a broken project on disk;
callers pass nothing and get `createShadowProgram`.
*/
export function cachedShadowProgram(
    cache: Map<string, ShadowProgram | undefined>,
    root: string,
    build: (root: string) => ShadowProgram = createShadowProgram,
): ShadowProgram | undefined {
    if (!cache.has(root)) {
        try {
            cache.set(root, build(root))
        } catch (error) {
            cache.set(root, undefined)
            const detail = error instanceof Error ? error.message : String(error)
            console.warn(
                `[abide] couldn't build the type program for ${root}: ${detail}\n` +
                    '  type-directed async detection is disabled for this project — a bare promise/stream\n' +
                    '  read like {getFoo()} renders as text instead of streaming. Check the tsconfig.',
            )
        }
    }
    return cache.get(root)
}
