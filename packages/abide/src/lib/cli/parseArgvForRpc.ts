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
args bag verbatim. Stdin: if a JSON object arrives piped in, it's used
as the full args bag (flags layer on top).

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
    nothing was piped, the read resolves with an empty string.
    */
    if (!process.stdin.isTTY) {
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
        const isNegated = token.startsWith('--no-')
        const rawName = isNegated ? token.slice('--no-'.length) : token.slice('--'.length)
        const [name, eqValue] = rawName.includes('=')
            ? [rawName.slice(0, rawName.indexOf('=')), rawName.slice(rawName.indexOf('=') + 1)]
            : [rawName, undefined]
        const prop = properties[name]
        const propType = prop?.type
        if (propType === 'boolean') {
            args[name] = !isNegated
            continue
        }
        if (isNegated) {
            throw new Error(`--no-${name} is only valid on boolean flags`)
        }
        const value = eqValue ?? argv[++index]
        if (value === undefined) {
            throw new Error(`--${name} requires a value`)
        }
        if (propType === 'number' || propType === 'integer') {
            const n = Number(value)
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
