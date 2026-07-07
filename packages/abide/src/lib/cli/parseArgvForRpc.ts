import { tokenizeArgvFlags } from './tokenizeArgvFlags.ts'

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

    /* The shared tokenizer owns the flag-consumption grammar (boolean / inline /
       `--json` / `--no-` negation). This loop layers RPC value semantics on each
       yielded token: JSON-blob merge, Number coercion, array accumulation. */
    for (const token of tokenizeArgvFlags(argv, jsonSchema)) {
        if (token.positional !== undefined) {
            throw new Error(`unexpected positional argument: ${token.positional}`)
        }
        if (token.isJson) {
            if (token.missingValue || token.value === undefined) {
                throw new Error('--json requires a value')
            }
            const parsed = JSON.parse(token.value)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('--json value must be a JSON object')
            }
            Object.assign(args, parsed)
            continue
        }
        // The tokenizer treats `--help` / `-h` as a help token; in RPC parsing
        // they are an unrecognised flag, surfaced loudly like any other.
        if (token.isHelp || token.name === undefined) {
            throw new Error('unexpected --help flag')
        }
        const name = token.name
        const propType = properties[name]?.type
        /* Coerce one string token to a schema scalar type (or throw). Shared by scalar
           props and array ELEMENTS so `--tags 1 --tags 2` on `z.array(z.number())` yields
           numbers, not strings the server then rejects. */
        const coerceScalar = (raw: string, type: string | undefined): unknown => {
            if (type === 'number' || type === 'integer') {
                // Reject a blank value explicitly — `Number('')` / `Number('  ')` is 0,
                // not NaN, so the NaN guard alone would silently coerce it to zero.
                const n = raw.trim() === '' ? Number.NaN : Number(raw)
                if (Number.isNaN(n)) {
                    throw new Error(`--${name} expects a number, got ${raw}`)
                }
                return n
            }
            if (type === 'boolean') {
                const lowered = raw.trim().toLowerCase()
                if (lowered === 'true' || lowered === '1') {
                    return true
                }
                if (lowered === 'false' || lowered === '0') {
                    return false
                }
                throw new Error(`--${name} expects true or false, got ${raw}`)
            }
            return raw
        }
        if (propType === 'boolean') {
            /* Bare `--flag` / `--no-flag` toggles; inline `--flag=false` honours the RHS
               instead of always resolving to true. */
            args[name] =
                token.value !== undefined ? coerceScalar(token.value, 'boolean') : !token.negated
            continue
        }
        if (token.missingValue || token.value === undefined) {
            throw new Error(`--${name} requires a value`)
        }
        const value = token.value
        if (propType === 'number' || propType === 'integer') {
            args[name] = coerceScalar(value, propType)
            continue
        }
        if (propType === 'array') {
            /* Coerce each repeated element per the schema's `items.type` — a string-only
               array arg silently fails server-side Zod validation for numeric/boolean items. */
            const itemType = (properties[name] as { items?: { type?: string } } | undefined)?.items
                ?.type
            const element = coerceScalar(value, itemType)
            const existing = args[name]
            args[name] = Array.isArray(existing) ? [...existing, element] : [element]
            continue
        }
        args[name] = value
    }

    return Object.keys(args).length === 0 ? undefined : args
}
