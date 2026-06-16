/*
Splits a session input line into argv tokens, honouring single and double quotes
so values with spaces survive (e.g. `post --title "hello world"`). Quotes group;
a backslash escapes the next character (outside single quotes). Unterminated
quotes consume to end of line. Pure; no shell features beyond quoting — no
globbing, no variable expansion.
*/
export function tokenizeLine(line: string): string[] {
    const tokens: string[] = []
    let current = ''
    let hasToken = false
    let quote: '"' | "'" | undefined
    for (let index = 0; index < line.length; index++) {
        const char = line[index]
        if (char === '\\' && quote !== "'") {
            const next = line[++index]
            if (next !== undefined) {
                current += next
                hasToken = true
            }
            continue
        }
        if (quote) {
            if (char === quote) {
                quote = undefined
            } else {
                current += char
            }
            continue
        }
        if (char === '"' || char === "'") {
            quote = char
            hasToken = true
            continue
        }
        if (char === ' ' || char === '\t') {
            if (hasToken) {
                tokens.push(current)
                current = ''
                hasToken = false
            }
            continue
        }
        current += char
        hasToken = true
    }
    if (hasToken) {
        tokens.push(current)
    }
    return tokens
}
