/*
The single argv-tail flag grammar shared by help-detection (runCli) and RPC arg
parsing (parseArgvForRpc) so the two can never drift. Walks the tail and yields
one token per flag occurrence, honouring the schema-driven consumption rule:

  - `--help` / `-h`               → { isHelp: true }, consumes no following token
  - `--json <blob>`               → { isJson: true, value }, consumes the next token
                                     (the value is the verbatim JSON args bag)
  - boolean props (and `--no-x`)  → { name, value: undefined }, consumes no token
  - `--name=value`                → { name, value }, inline, consumes no token
  - everything else               → { name, value }, consumes the next token

`--no-x` negates only a known boolean property x; otherwise the literal `no-…`
name is kept so a property legitimately named `no-…` stays reachable. Reports
`negated` and `missingValue` so the parser can apply boolean/coercion semantics
and throw precise errors. A bare positional (no leading `--`) yields
{ positional: token } so each consumer rejects or ignores it as it sees fit.

Pure; reads the schema's `properties` only to classify boolean props.
*/
export function* tokenizeArgvFlags(
    argvTail: string[],
    jsonSchema: Record<string, unknown> | undefined,
): Generator<{
    isHelp?: boolean
    isJson?: boolean
    positional?: string
    name?: string
    value?: string
    negated?: boolean
    missingValue?: boolean
}> {
    const properties =
        (jsonSchema?.properties as Record<string, { type?: string }> | undefined) ?? {}
    for (let index = 0; index < argvTail.length; index += 1) {
        const token = argvTail[index] as string
        if (token === '--help' || token === '-h') {
            yield { isHelp: true }
            continue
        }
        if (!token.startsWith('--')) {
            yield { positional: token }
            continue
        }
        // `--json <blob>`: the next token is the verbatim JSON args bag.
        if (token === '--json') {
            const value = argvTail[index + 1]
            if (value === undefined) {
                yield { isJson: true, missingValue: true }
            } else {
                index += 1
                yield { isJson: true, value }
            }
            continue
        }
        const stripped = token.slice('--'.length)
        const [literalName, inlineValue] = stripped.includes('=')
            ? [stripped.slice(0, stripped.indexOf('=')), stripped.slice(stripped.indexOf('=') + 1)]
            : [stripped, undefined]
        /* `--no-x` negates only a known boolean property x; otherwise the literal
           name wins, so a property legitimately named `no-…` stays reachable. */
        const negatedName = literalName.startsWith('no-')
            ? literalName.slice('no-'.length)
            : undefined
        const negated = negatedName !== undefined && properties[negatedName]?.type === 'boolean'
        const name = negated ? (negatedName as string) : literalName
        // Boolean props and inline `--name=value` consume no following token. Pass any
        // inline value through (`--flag=false`) so the parser can honour the RHS instead
        // of the boolean always resolving to true.
        if (properties[name]?.type === 'boolean') {
            yield { name, negated, value: inlineValue }
            continue
        }
        if (inlineValue !== undefined) {
            yield { name, value: inlineValue }
            continue
        }
        const value = argvTail[index + 1]
        if (value === undefined) {
            yield { name, missingValue: true }
        } else {
            index += 1
            yield { name, value }
        }
    }
}
