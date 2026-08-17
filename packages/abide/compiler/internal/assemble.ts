// How a JSON Schema is ASSEMBLED, in the one place both derivations reach for.
//
// There are two of those and there have to be: `shape.ts` reads TOKENS and `checked.ts` reads a
// checker's `Type`, and they answer different questions from different inputs in different processes.
// What they must never differ about is the ANSWER — an endpoint whose published shape changes
// spelling depending on whether a build step ran is an endpoint whose document nobody can diff.
//
// They differed. `string | null` came out `["string","null"]` from one and `["null","string"]` from
// the other; a `Record` grew an empty `properties` on one side only; a tuple lost every element after
// the first; and `flag: true` published `const: false`, because a boolean literal carries its value
// in `value` and the checker half was reading `intrinsicName`. Two of those were cosmetic and two
// were wrong — one of them over-constraining, which is the one direction a derived shape may not err
// in. All four were the same cause: the same decision made twice.
//
// So every decision that turns parts into a schema is made HERE, once. What stays in each derivation
// is only how to get the parts.
//
// Written in the TypeScript Node can strip rather than transform — no parameter properties, no
// enums, no namespaces — because `checked.ts` runs under Node, and the type import below is erased
// rather than resolved, which is what lets an alias appear in a file Node loads.

import type { JsonSchema, JsonType } from '#shared/internal/shapes.ts'

/** Anything matches this, and it is what both derivations answer for a type they cannot describe. */
export const ANYTHING: JsonSchema = {}

/**
 * DEFINED keys, not present ones. Every builder here writes the fields it does not know as
 * `undefined` rather than omitting them — one hidden class per schema kind for the reads in `union`,
 * `merged` and `inherited`, which walk them per member and per alternative — so "has no keys" is no
 * longer the same question as "says nothing". `JSON.stringify` drops an undefined value, so the
 * published document is unchanged either way.
 */
export function isAnything(schema: JsonSchema): boolean {
    // Its OWN loop, exiting on the first field that says something — the common answer is "no", and
    // routing it through `described` walked every key to count past the one that already settled it.
    for (const key in schema) {
        if ((schema as unknown as Record<string, unknown>)[key] !== undefined) return false
    }
    return true
}

/**
 * A schema worth CARRYING, as both derivations must agree it is.
 *
 * One that says nothing is dropped to `undefined` here rather than published as an absent key, so a
 * `Shapes` from the syntactic reader and one from the checker are the same record for the same
 * endpoint — the two spelling an answer differently is the whole failure `checked.ts`'s header is
 * about.
 */
export function usable(schema: JsonSchema | undefined): schema is JsonSchema {
    return schema !== undefined && !isAnything(schema)
}

/** How many fields this schema actually claims — the count `union` needs, where 1 is the question. */
function described(schema: JsonSchema): number {
    let count = 0
    for (const key in schema) {
        if ((schema as unknown as Record<string, unknown>)[key] !== undefined) count++
    }
    return count
}

/**
 * Every type KEYWORD, by the name both derivations see it under.
 *
 * The token pass reads the name off a token and the checker pass reads it off `intrinsicName`, but
 * what the name MEANS is one decision and it is made here — the two had already drifted, with
 * `object` and `symbol` derivable on one side only and `never` optional on one side only.
 *
 * `Anything` for `any`/`unknown` is the honest answer, and for `bigint` it is the only one: a bigint
 * has no JSON form at all, so a shape claiming one would refuse a caller who sent what the type asks
 * for.
 */
export const INTRINSICS: Record<string, JsonSchema> = {
    string: { type: 'string' },
    number: { type: 'number' },
    boolean: { type: 'boolean' },
    null: { type: 'null' },
    true: { type: 'boolean', const: true },
    false: { type: 'boolean', const: false },
    undefined: ANYTHING,
    void: ANYTHING,
    never: ANYTHING,
    any: ANYTHING,
    unknown: ANYTHING,
    object: ANYTHING,
    bigint: ANYTHING,
    symbol: ANYTHING,
}

/**
 * The keywords that mean "nothing arrives", which is a MEMBER being optional rather than a shape.
 *
 * Beside the table rather than inside it, because it is a fact about the name and not about the
 * schema: all three derive to `{}`, and what separates them from `any` is what holding one does to
 * the member that holds it.
 */
export const NOTHING = new Set(['undefined', 'void', 'never'])

/**
 * The values that ARE a string once they cross, by the name their type is written with.
 *
 * The published shape is the WIRE form in each case, because that is what a machine reading the
 * document is about to send. `src/server/schema.ts` is what accepts the local form beside it, and
 * the two lists have to name the same formats — `shapes.test.ts` is where that is asserted, because
 * the server cannot import this file and this file cannot import the server.
 */
export const NAMED_FORMATS: Record<string, JsonSchema> = {
    Date: { type: 'string', format: 'date-time' },
    URL: { type: 'string', format: 'uri' },
    File: { type: 'string', format: 'binary' },
    Blob: { type: 'string', format: 'binary' },
}

export function formatOf(name: string | undefined): JsonSchema | null {
    if (name === undefined) return null
    const found = NAMED_FORMATS[name]
    return found === undefined ? null : { ...found }
}

/**
 * A union, as the narrowest of the spellings that still says it.
 *
 * Sorted where a set is involved, and that is the deliberate half: source order reads better to a
 * person, and a checker cannot reproduce it — so the ONE order both halves can agree on is the one
 * neither of them chose.
 */
export function union(parts: JsonSchema[]): JsonSchema {
    if (parts.length === 0) return ANYTHING
    for (let i = 0; i < parts.length; i++) if (isAnything(parts[i] as JsonSchema)) return ANYTHING
    if (parts.length === 1) return parts[0] as JsonSchema

    const literals: unknown[] = []
    const kinds = new Set<JsonType>()
    let allLiteral = true
    let allBare = true
    for (const part of parts) {
        if ('const' in part) literals.push(part.const)
        else allLiteral = false
        if (typeof part.type === 'string') kinds.add(part.type)
        if (typeof part.type !== 'string' || described(part) !== 1) allBare = false
    }
    // `true | false` is a boolean, not a two-value enum — which is what the checker hands over for
    // one, and what an author who wrote `boolean` meant.
    if (allLiteral && kinds.size === 1 && kinds.has('boolean')) return { type: 'boolean' }
    if (allLiteral) {
        return kinds.size === 1 ? { type: [...kinds][0] as JsonType, enum: literals } : { enum: literals }
    }
    if (allBare) return { type: [...kinds].sort() }
    return { anyOf: parts }
}

export function arrayOf(items: JsonSchema): JsonSchema {
    // One literal, both fields — the same reason `objectOf` builds four, and the sibling that was
    // missed when it did: two shapes for one schema kind, read by the same per-alternative and
    // per-part loops.
    return { type: 'array', items: isAnything(items) ? undefined : items }
}

/**
 * An object from its members.
 *
 * `properties` is omitted when empty rather than written as `{}`, and an object with no members and
 * no index signature is not an object at all — `{}` says "nothing is known" more honestly than a
 * shape that claims to describe something and describes nothing.
 */
export function objectOf(
    properties: Record<string, JsonSchema>,
    required: string[],
    additional: JsonSchema | undefined,
): JsonSchema {
    const names = Object.keys(properties)
    if (names.length === 0 && additional === undefined) return ANYTHING
    // One literal, all four fields — the three unknown ones written as `undefined` rather than added
    // on a later path. This is the only constructor of an object schema in either derivation, so
    // growing it conditionally made up to eight shapes for the reads in `union`'s per-alternative
    // loop and `merged`/`inherited`'s per-part loops.
    return {
        type: 'object',
        properties: names.length > 0 ? properties : undefined,
        required: required.length > 0 ? required : undefined,
        additionalProperties: additional !== undefined && !isAnything(additional) ? additional : undefined,
    }
}
