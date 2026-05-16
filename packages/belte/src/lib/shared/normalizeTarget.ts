import type { CompileTarget } from '../types/CompileTarget.ts'

export function normalizeTarget(input: string): CompileTarget {
    const normalized = input.startsWith('bun-') ? input : `bun-${input}`
    return normalized as CompileTarget
}
