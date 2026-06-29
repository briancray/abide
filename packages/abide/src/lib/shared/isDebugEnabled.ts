import { debugGate } from './debugGate.ts'

/*
Whether a DEBUG-gated channel is enabled, npm-debug conventions:
DEBUG="abide"           → enables "abide"
DEBUG="abide:*"         → enables "abide" and "abide:anything"
DEBUG="*"               → enables everything
DEBUG="a,abide"         → comma-separated list
DEBUG="abide:*,-abide:cache" → negation: exclusions win over inclusions
Always-on channels don't consult this — they check isDebugNegated only.
The default is guarded: this runs in the browser bundle, where `process`
doesn't exist. Decision routed through debugGate, memoized per DEBUG value.
*/
export function isDebugEnabled(
    name: string,
    env: string | undefined = typeof process === 'undefined' ? undefined : process.env.DEBUG,
): boolean {
    return debugGate(env).enabled(name)
}
