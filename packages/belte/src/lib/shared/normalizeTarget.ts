import type { CompileTarget } from '../server/runtime/types/CompileTarget.ts'

/*
Prepends the `bun-` prefix if missing so CLI users can pass either
`darwin-arm64` or the canonical `bun-darwin-arm64` form to `--target`.
*/
export function normalizeTarget(input: string): CompileTarget {
    const normalized = input.startsWith('bun-') ? input : `bun-${input}`
    return normalized as CompileTarget
}
