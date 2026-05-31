const ENV_LINE = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/

/*
Parses `.env` text into a key→value record. Skips blanks, comments, and
malformed lines; strips a single layer of surrounding single or double quotes.
Intentionally minimal — no variable expansion, escapes, or multi-line. The pure
counterpart to loadEnvFile (which merges into process.env) and serializeEnv
(which writes records back), so all three round-trip the same shape.
*/
export function parseEnv(text: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const line of text.split('\n')) {
        if (!line || line.startsWith('#')) {
            continue
        }
        const match = ENV_LINE.exec(line)
        if (!match) {
            continue
        }
        const [, key, rawValue] = match
        const trimmed = rawValue?.trim() ?? ''
        const unquoted =
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
                ? trimmed.slice(1, -1)
                : trimmed
        result[key as string] = unquoted
    }
    return result
}
