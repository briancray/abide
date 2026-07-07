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
    // Split on CRLF or LF — a Windows-saved (or git autocrlf) .env otherwise leaves a
    // trailing \r that breaks ENV_LINE's `$` anchor, silently dropping every line.
    for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith('#')) {
            continue
        }
        const match = ENV_LINE.exec(line)
        if (!match) {
            continue
        }
        const [, key, rawValue] = match
        const trimmed = rawValue?.trim() ?? ''
        let unquoted: string
        if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
            // Double-quoted: unescape the sequences serializeEnv writes (`\\`, `\"`, `\n`, `\r`).
            unquoted = trimmed
                .slice(1, -1)
                .replace(/\\([nr"\\])/g, (_, c: string) =>
                    c === 'n' ? '\n' : c === 'r' ? '\r' : c,
                )
        } else if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
            // Single-quoted: taken verbatim (no escaping applied on the way out).
            unquoted = trimmed.slice(1, -1)
        } else {
            unquoted = trimmed
        }
        result[key as string] = unquoted
    }
    return result
}
