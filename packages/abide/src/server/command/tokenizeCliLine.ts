// Split a command line into argv the way the prompt and the completer both must: one rule, because a
// completer that disagreed with the parser would complete a word the parser then splits differently.
// Backslash escaping is deliberately absent — this is a prompt, not a shell.
export function tokenizeCliLine(line: string): string[] {
    const tokens: string[] = []
    let current = ''
    let quote: string | undefined
    let started = false
    for (const character of line) {
        if (quote !== undefined) {
            if (character === quote) quote = undefined
            else current += character
            continue
        }
        if (character === '"' || character === "'") {
            quote = character
            started = true
            continue
        }
        if (character === ' ' || character === '\t') {
            if (started) tokens.push(current)
            current = ''
            started = false
            continue
        }
        current += character
        started = true
    }
    if (started) tokens.push(current)
    return tokens
}
