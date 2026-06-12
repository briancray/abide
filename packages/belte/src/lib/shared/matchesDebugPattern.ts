/*
One DEBUG pattern against one channel name, npm-debug conventions:
`*` matches everything, `belte:*` matches 'belte' and every 'belte:…'
sub-channel, anything else matches exactly. Negation (`-` prefix) is the
caller's concern — patterns arrive here already stripped.
*/
export function matchesDebugPattern(name: string, pattern: string): boolean {
    if (pattern === '*') {
        return true
    }
    if (pattern.endsWith(':*')) {
        const prefix = pattern.slice(0, -2)
        return name === prefix || name.startsWith(`${prefix}:`)
    }
    return pattern === name
}
