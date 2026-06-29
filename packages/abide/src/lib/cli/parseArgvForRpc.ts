/*
Parses an argv tail into the JSON args bag for an RPC. The JSON Schema
on the manifest entry (when present) drives flag typing:
  - properties whose type is "boolean" accept `--name` / `--no-name`
  - properties whose type is "number" / "integer" accept `--name <n>` and
    coerce with Number()
  - properties whose type is "array" accept repeated `--name <v>`
  - anything else accepts `--name <value>` as a string

For complex shapes (nested objects, unions, anyOf) the CLI exposes
`--json <stringified-args>` as an escape hatch that supplies the whole
args bag verbatim. Stdin: if a JSON object arrives piped in with no argv flags, it is used
as the full args bag. Stdin and flags are mutually exclusive — stdin is
skipped when argv is non-empty to avoid hanging on a pipe that never
sends EOF.

Unrecognised flags throw — early loud feedback is more useful than
silent drops.
*/
export async function parseArgvForRpc(
    argv: string[],
    jsonSchema: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
    const properties =
        (jsonSchema?.properties as Record<string, { type?: string }> | undefined) ?? {}
    const args: Record<string, unknown> = {}

    /*
    Stdin override: if a JSON object is piped in, treat it as the
    starting args bag. `Bun.stdin.text()` reads the whole pipe; if
    nothing was piped, the read resolves with an empty string. Skip the
    read entirely when argv already supplied args — a non-TTY pipe that
    never sends EOF would otherwise hang the call forever even though the
    args are fully on the command line.
    */
    if (!process.stdin.isTTY && argv.length === 0) {
        const text = await Bun.stdin.text()
        if (text.trim()) {
            try {
                const piped = JSON.parse(text)
                if (piped && typeof piped === 'object' && !Array.isArray(piped)) {
                    Object.assign(args, piped)
                }
            } catch {
                throw new Error(`stdin is not a valid JSON object: ${text.slice(0, 80)}…`)
            }
        }
    }

    for (let index = 0; index < argv.length; index++) {
        const token = argv[index] as string
        if (token === '--json') {
            const next = argv[++index]
            if (!next) {
                throw new Error('--json requires a value')
            }
            const parsed = JSON.parse(next)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('--json value must be a JSON object')
            }
            Object.assign(args, parsed)
            continue
        }
        if (!token.startsWith('--')) {
            throw new Error(`unexpected positional argument: ${token}`)
        }
        const stripped = token.slice('--'.length)
        const [literalName, eqValue] = stripped.includes('=')
            ? [stripped.slice(0, stripped.indexOf('=')), stripped.slice(stripped.indexOf('=') + 1)]
            : [stripped, undefined]
        /* `--no-x` negates only a known boolean property x; otherwise the literal
           name wins, so a property legitimately named `no-…` stays reachable. */
        const negatedName = literalName.startsWith('no-')
            ? literalName.slice('no-'.length)
            : undefined
        const isNegated = negatedName !== undefined && properties[negatedName]?.type === 'boolean'
        const name = isNegated ? (negatedName as string) : literalName
        const prop = properties[name]
        const propType = prop?.type
        if (propType === 'boolean') {
            args[name] = !isNegated
            continue
        }
        const value = eqValue ?? argv[++index]
        if (value === undefined) {
            throw new Error(`--${name} requires a value`)
        }
        if (propType === 'number' || propType === 'integer') {
            // Reject a blank value explicitly — `Number('')` / `Number('  ')` is 0,
            // not NaN, so the NaN guard alone would silently coerce it to zero.
            const n = value.trim() === '' ? Number.NaN : Number(value)
            if (Number.isNaN(n)) {
                throw new Error(`--${name} expects a number, got ${value}`)
            }
            args[name] = n
            continue
        }
        if (propType === 'array') {
            const existing = args[name]
            args[name] = Array.isArray(existing) ? [...existing, value] : [value]
            continue
        }
        args[name] = value
    }

    return Object.keys(args).length === 0 ? undefined : args
}
