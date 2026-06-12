/*
DEBUG's comma list, parsed once per distinct string — the gate runs on every
log emission, and the env never changes server-side. A single-slot memo
suffices: the browser's belte-debug localStorage toggle produces a new string
that misses the memo and reparses.
*/
let lastEnv: string | undefined
let lastPatterns: string[] = []

export function parseDebugPatterns(env: string | undefined): string[] {
    if (env !== lastEnv) {
        lastEnv = env
        lastPatterns = env
            ? env
                  .split(',')
                  .map((raw) => raw.trim())
                  .filter((pattern) => pattern !== '')
            : []
    }
    return lastPatterns
}
