// Quote only values that wouldn't round-trip bare through parseEnv — empties and
// anything carrying whitespace or a `#` (which would otherwise read as a comment).
function needsQuoting(value: string): boolean {
    return value === '' || /[\s#]/.test(value)
}

/*
Serializes a key→value record to `.env` text — the inverse of parseEnv, used by
the connect-screen config form to persist the user's answers to the data-dir
`.env`. One `KEY=value` per line; values that need it are wrapped in double
quotes so parseEnv reads them back unchanged.
*/
export function serializeEnv(values: Record<string, string>): string {
    const lines = Object.entries(values).map(([key, value]) =>
        needsQuoting(value) ? `${key}="${value}"` : `${key}=${value}`,
    )
    return `${lines.join('\n')}\n`
}
