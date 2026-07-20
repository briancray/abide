// Split a snippet/param list at top-level commas — bracket/brace/paren-depth aware so a destructuring
// param (`{ a, b }`) or a default with a comma-bearing initializer stays one part. Empty parts drop.
export function splitParams(params: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < params.length; i++) {
        const char = params[i]
        if (char === '{' || char === '[' || char === '(') depth++
        else if (char === '}' || char === ']' || char === ')') depth--
        else if (char === ',' && depth === 0) {
            parts.push(params.slice(start, i).trim())
            start = i + 1
        }
    }
    parts.push(params.slice(start).trim())
    return parts.filter((p) => p !== '')
}
