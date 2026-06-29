import type { DebugGate } from './types/DebugGate.ts'

/*
The DEBUG-gate core: one memoized decision-maker per distinct DEBUG string,
npm-debug conventions. `enabled(name)` answers "is gated channel X on?",
`negated(name)` answers "did a `-X` pattern explicitly shut it off?" — the two
questions isDebugEnabled / isDebugNegated expose. Both were re-deriving the same
parse + filter work on every emission; here the include/exclude partition is
computed once per env value (a single pass, not two throwaway-array filters) and
each per-name boolean is cached, since the server's DEBUG is stable and channel
names are a tiny fixed set.

A new env string (the browser's abide-debug localStorage toggle, or tests
mutating process.env.DEBUG) misses the single-slot memo and rebuilds — so a
runtime DEBUG change takes effect on its next read.
*/

// One DEBUG pattern (already `-`-stripped) against one channel name: `*` matches
// everything, `abide:*` matches 'abide' and every 'abide:…' sub-channel, else exact.
function matches(name: string, pattern: string): boolean {
    if (pattern === '*') {
        return true
    }
    if (pattern.endsWith(':*')) {
        const prefix = pattern.slice(0, -2)
        return name === prefix || name.startsWith(`${prefix}:`)
    }
    return pattern === name
}

// Builds a gate for one env value: partitions the comma list into include/exclude
// patterns in a single pass, then memoizes each per-name decision in a map.
function buildGate(env: string | undefined): DebugGate {
    const includes: string[] = []
    const excludes: string[] = []
    if (env) {
        for (const raw of env.split(',')) {
            const pattern = raw.trim()
            if (pattern === '') {
                continue
            }
            if (pattern.startsWith('-')) {
                excludes.push(pattern.slice(1))
            } else {
                includes.push(pattern)
            }
        }
    }
    /* Cache-hit fast path: a Map keyed on channel name, since names are a tiny
       fixed set and the gate runs on every log emission. Negated and enabled
       cache separately — a channel can be queried through either question. */
    const negatedCache = new Map<string, boolean>()
    const enabledCache = new Map<string, boolean>()
    return {
        negated(name: string): boolean {
            const cached = negatedCache.get(name)
            if (cached !== undefined) {
                return cached
            }
            const result = excludes.some((pattern) => matches(name, pattern))
            negatedCache.set(name, result)
            return result
        },
        enabled(name: string): boolean {
            const cached = enabledCache.get(name)
            if (cached !== undefined) {
                return cached
            }
            // Exclusions win over inclusions (npm-debug negation precedence).
            const result =
                !excludes.some((pattern) => matches(name, pattern)) &&
                includes.some((pattern) => matches(name, pattern))
            enabledCache.set(name, result)
            return result
        },
    }
}

/* Single-slot memo on the env string: the gate (partition + decision caches) is
   rebuilt only when DEBUG changes. */
let lastEnv: string | undefined
let lastGate: DebugGate = buildGate(undefined)

export function debugGate(env: string | undefined): DebugGate {
    if (env !== lastEnv) {
        lastEnv = env
        lastGate = buildGate(env)
    }
    return lastGate
}
