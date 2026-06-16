import type { CompileTarget } from './types/CompileTarget.ts'

/* The canonical cross-compile targets, as a runtime set for validation. */
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
