/**
 * Matches the conventions of the `debug` npm package.
 * DEBUG="belte"   → enables "belte"
 * DEBUG="belte:*" → enables "belte" and "belte:anything"
 * DEBUG="*"       → enables everything
 * DEBUG="a,belte" → comma-separated list
 */
export function isDebugEnabled(name: string, env: string | undefined = process.env.DEBUG): boolean {
    if (!env) {
        return false
    }
    return env.split(',').some((raw) => {
        const pattern = raw.trim()
        if (pattern === '*') {
            return true
        }
        if (pattern.endsWith(':*')) {
            const prefix = pattern.slice(0, -2)
            return name === prefix || name.startsWith(`${prefix}:`)
        }
        return pattern === name
    })
}
