import { matchesDebugPattern } from './matchesDebugPattern.ts'
import { parseDebugPatterns } from './parseDebugPatterns.ts'

/*
Whether a `-` pattern in DEBUG explicitly shuts a channel off — the off
switch for the always-on channels (the app's name, 'belte'): DEBUG="-belte"
silences framework lines including the per-request closing records,
DEBUG="-myapp" the app's own. Silencing a channel silences all its levels —
levels never gate, in either direction. The default is guarded: this runs in
the browser bundle, where `process` doesn't exist.
*/
export function isDebugNegated(
    name: string,
    env: string | undefined = typeof process === 'undefined' ? undefined : process.env.DEBUG,
): boolean {
    return parseDebugPatterns(env)
        .filter((pattern) => pattern.startsWith('-'))
        .some((pattern) => matchesDebugPattern(name, pattern.slice(1)))
}
