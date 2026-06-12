import { isDebugNegated } from './isDebugNegated.ts'
import { matchesDebugPattern } from './matchesDebugPattern.ts'
import { parseDebugPatterns } from './parseDebugPatterns.ts'

/*
Whether a DEBUG-gated channel is enabled, npm-debug conventions:
DEBUG="belte"           → enables "belte"
DEBUG="belte:*"         → enables "belte" and "belte:anything"
DEBUG="*"               → enables everything
DEBUG="a,belte"         → comma-separated list
DEBUG="belte:*,-belte:svelte" → negation: exclusions win over inclusions
Always-on channels don't consult this — they check isDebugNegated only.
The default is guarded: this runs in the browser bundle, where `process`
doesn't exist.
*/
export function isDebugEnabled(
    name: string,
    env: string | undefined = typeof process === 'undefined' ? undefined : process.env.DEBUG,
): boolean {
    if (isDebugNegated(name, env)) {
        return false
    }
    return parseDebugPatterns(env)
        .filter((pattern) => !pattern.startsWith('-'))
        .some((pattern) => matchesDebugPattern(name, pattern))
}
