// Quote any value that wouldn't round-trip bare through parseEnv: empties, anything
// carrying whitespace/`#` (a comment)/a quote/a backslash, or one that starts or ends with
// a quote char (parseEnv strips a surrounding quote pair). Everything else stays bare.
function needsQuoting(value: string): boolean {
    return value === '' || /[\s#"\\]/.test(value) || /^['"]|['"]$/.test(value)
}

// Escape a value for inside double quotes: backslash and quote so the closing quote can't
// be faked, and newlines so an embedded `\n` can't inject a whole new `KEY=value` line
// (the security fix — an unescaped token newline used to forge extra env entries).
function escapeQuoted(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
}

/*
Serializes a key→value record to `.env` text — the inverse of parseEnv, used by
the connect-screen config form to persist the user's answers to the data-dir
`.env`. One `KEY=value` per line; values that need it are double-quoted and escaped
so parseEnv reads them back unchanged and a value can never inject extra lines.
*/
export function serializeEnv(values: Record<string, string>): string {
    const lines = Object.entries(values).map(([key, value]) =>
        needsQuoting(value) ? `${key}="${escapeQuoted(value)}"` : `${key}=${value}`,
    )
    return `${lines.join('\n')}\n`
}
