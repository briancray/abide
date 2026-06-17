import type { CompileTarget } from './types/CompileTarget.ts'

/* The canonical cross-compile targets, as a runtime set for validation. Kept
   separate from `detectTarget`'s `HOST_TO_TARGET` on purpose, though the two lists
   coincide today: this is "every target `--target` accepts" (all cross-targets),
   while that map is "targets auto-detectable from a host". A future Bun target that
   no host maps to (a new arch/libc we cross-compile to but don't run on) belongs
   here and not there — deriving one from the other would couple distinct concerns.
   Both stay aligned to `CompileTarget`, the single source of truth. */
const COMPILE_TARGETS: readonly CompileTarget[] = [
    'bun-darwin-arm64',
    'bun-darwin-x64',
    'bun-linux-arm64',
    'bun-linux-x64',
    'bun-windows-x64',
]

/* Narrows an arbitrary string to a known CompileTarget. */
export function isCompileTarget(value: string): value is CompileTarget {
    return (COMPILE_TARGETS as readonly string[]).includes(value)
}
