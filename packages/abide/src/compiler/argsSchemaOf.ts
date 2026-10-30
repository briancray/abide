// 19.9 — A HANDLER'S ARGS, AS THE JSON SCHEMA ITS TYPESCRIPT ANNOTATION SAYS, derived at build by
// the checker the build already holds. A URL carries text and a caller outside the process carries
// whatever it likes, so `({ id }: { id: number })` is a promise only the in-process call keeps; this
// is what lets the wire keep it too — coerced (19.7), validated, and published (20.11) with no
// schema written twice.
//
// 19.11 — THE DIALECT IS `validateJson`'s, and a type it cannot say is `{}` — no constraint — rather than a
// guess: a function, a class, a generic still open. Narrower than the type is a refusal an author
// never wrote; wider is the handler's own concern, which is where it was before.

import {
    type Checker,
    type LiteralType,
    SignatureKind,
    SymbolFlags,
    type Type,
    TypeFlags,
    type TypeReference,
    type UnionOrIntersectionType,
} from 'typescript/unstable/async'

import type { JsonValue } from '#shared/JsonValue.ts'

type Schema = { [keyword: string]: JsonValue }

/**
 * What one schema walk remembers: the object types it has answered, and how deep it is.
 *
 * ONE WALK'S MEMORY: each object type walked once, whatever reaches it again, and a depth past which
 * a type is `{}`. An args record is JSON a few levels deep; a type that reaches the DOM or the lib's
 * class graph instead is wide enough to walk for minutes, and widening it is 19.11's answer.
 */
export type Walk<Seen = Map<number, Schema>> = { seen: Seen; depth: number }
/**
 * A schema walk, and which side of the wire it describes: what a caller SENDS, or what a handler
 * ANSWERS (19.21).
 */
type SchemaWalk = Walk & { result: boolean }
/** The depth a walk stops at: an object type this deep or deeper is not walked. */
export const DEEPEST = 8

/**
 * The JSON Schema of a handler's args record, or `undefined` where it takes no record.
 *
 * What the first parameter of the `Rpc`'s call takes, or `undefined` where it takes no record —
 * with each member the handler defaults made optional (19.10).
 */
export async function argsSchemaOf(
    checker: Checker,
    handler: Type,
    defaulted: string[],
): Promise<Schema | undefined> {
    const [call] = await checker.getSignaturesOfType(
        handler,
        SignatureKind.Call,
    )
    const args =
        call === undefined ? undefined : await checker.getParameterType(call, 0)
    if (args === undefined) return undefined
    const schema = await schemaOf(checker, args, {
        seen: new Map(),
        depth: 0,
        result: false,
    })
    if (schema.type !== 'object') return undefined
    const required = schema.required as string[] | undefined
    if (required !== undefined && defaulted.length > 0) {
        const kept = required.filter((name) => !defaulted.includes(name))
        if (kept.length > 0) schema.required = kept
        else delete schema.required
    }
    return schema
}

/**
 * The JSON Schema of what a handler answers, or `undefined` where it says nothing true of it.
 *
 * 19.21 — `value` is what the handler's `Rpc` reads, refusals already out of it. A value that may be
 * nothing answers 204 rather than JSON, and a value the walk can say nothing of — `unknown`, a
 * `Response`, a stream, a class instance — publishes no schema rather than `{}`.
 */
export async function resultSchemaOf(
    checker: Checker,
    value: Type | undefined,
): Promise<Schema | undefined> {
    if (value === undefined || (await holdsUndefined(value))) return undefined
    const schema = await schemaOf(checker, value, {
        seen: new Map(),
        depth: 0,
        result: true,
    })
    return Object.keys(schema).length === 0 ? undefined : schema
}

async function schemaOf(
    checker: Checker,
    type: Type,
    walk: SchemaWalk,
): Promise<Schema> {
    const flags = type.flags
    if (flags & TypeFlags.String) return { type: 'string' }
    if (flags & TypeFlags.Number) return { type: 'number' }
    if (flags & TypeFlags.Boolean) return { type: 'boolean' }
    if (flags & TypeFlags.Null) return { type: 'null' }
    if (flags & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral))
        return literalsOf([type])
    if (flags & TypeFlags.BooleanLiteral)
        return {
            type: 'boolean',
            const: (type as LiteralType).value as boolean,
        }
    if (flags & TypeFlags.Union)
        return unionOf(checker, type as UnionOrIntersectionType, walk)
    if (!(flags & (TypeFlags.Object | TypeFlags.Intersection))) return {}
    // A type reached again — inside itself, or from a second member — answers what it answered, and
    // one still being walked answers `{}`: a recursive type says nothing more the second time.
    const known = walk.seen.get(type.id)
    if (known !== undefined) return known
    if (walk.depth >= DEEPEST) return {}
    const pending: Schema = {}
    walk.seen.set(type.id, pending)
    const inner: SchemaWalk = {
        seen: walk.seen,
        depth: walk.depth + 1,
        result: walk.result,
    }
    // Three questions of one type, asked together rather than one round trip after another.
    const [array, tuple, calls] = await Promise.all([
        checker.isArrayType(type),
        checker.isTupleType(type),
        checker.getSignaturesOfType(type, SignatureKind.Call),
    ])
    let schema: Schema
    if (array) {
        const [item] = await checker.getTypeArguments(type as TypeReference)
        schema =
            item === undefined
                ? { type: 'array' }
                : { type: 'array', items: await schemaOf(checker, item, inner) }
    } else if (tuple) schema = { type: 'array' }
    else if (calls.length > 0) schema = {}
    else schema = await objectOf(checker, type, inner)
    walk.seen.set(type.id, schema)
    return schema
}

async function objectOf(
    checker: Checker,
    type: Type,
    walk: SchemaWalk,
): Promise<Schema> {
    const properties: Schema = {}
    const required: string[] = []
    const members = await checker.getPropertiesOfType(type)
    // Every member's type in one round trip.
    const types = await checker.getTypeOfSymbol(members)
    for (let at = 0; at < members.length; at += 1) {
        const property = members[at] as (typeof members)[number]
        const value = types[at]
        if (value === undefined) continue
        // 19.22 — AN ANSWER WITH A METHOD IS AN INSTANCE, and what `JSON.stringify` makes of one is
        // its own `toJSON`'s or its fields', neither of which its members say.
        if (
            walk.result &&
            (await checker.getSignaturesOfType(value, SignatureKind.Call))
                .length > 0
        )
            return {}
        properties[property.name] = await schemaOf(checker, value, walk)
        // A member JSON can leave out is not required, whether `?` said so or `| undefined` did.
        if (
            (property.flags & SymbolFlags.Optional) === 0 &&
            !(await holdsUndefined(value))
        )
            required.push(property.name)
    }
    const schema: Schema = { type: 'object', properties }
    if (required.length > 0) schema.required = required
    // 19.18 — A MEMBER THE TYPE DOES NOT DECLARE IS REFUSED, where no index signature declares the
    // rest: a caller outside the process sends whatever it likes, and a body writing its args to a
    // row would write that too. An author who wants the rest declares a schema of their own. 19.22 —
    // an answer is wider than its type wherever the value handed back was.
    if (!walk.result) schema.additionalProperties = false
    for (const index of await checker.getIndexInfosOfType(type))
        if (index.keyType.flags & TypeFlags.String)
            schema.additionalProperties = await schemaOf(
                checker,
                index.valueType,
                walk,
            )
    return schema
}

/**
 * A union, with what JSON cannot carry dropped: `undefined` is an absent member rather than a value.
 * `true | false` is `boolean`, a run of one kind's literals is an `enum` under that kind's `type` —
 * the `type` is what 19.7 coerces text by — and bare kinds merge into one `type` list.
 */
async function unionOf(
    checker: Checker,
    union: UnionOrIntersectionType,
    walk: SchemaWalk,
): Promise<Schema> {
    const all = await union.getTypes()
    const members: Type[] = []
    const literals: Type[] = []
    let booleans = 0
    for (const member of all) {
        if (member.flags & (TypeFlags.Undefined | TypeFlags.Void)) continue
        if (member.flags & TypeFlags.BooleanLiteral) booleans += 1
        else if (
            member.flags &
            (TypeFlags.StringLiteral | TypeFlags.NumberLiteral)
        )
            literals.push(member)
        else members.push(member)
    }
    const schemas: Schema[] = []
    if (literals.length > 0) schemas.push(...literalGroups(literals))
    if (booleans === 2) schemas.push({ type: 'boolean' })
    else if (booleans === 1)
        for (const member of all)
            if (member.flags & TypeFlags.BooleanLiteral)
                schemas.push({
                    type: 'boolean',
                    const: (member as LiteralType).value as boolean,
                })
    for (const member of members) {
        const schema = await schemaOf(checker, member, walk)
        // An arm that says nothing leaves the union saying nothing.
        if (Object.keys(schema).length === 0) return schema
        schemas.push(schema)
    }
    if (schemas.length === 1) return schemas[0] as Schema
    const kinds: string[] = []
    for (const schema of schemas) {
        if (Object.keys(schema).length !== 1 || typeof schema.type !== 'string')
            return { anyOf: schemas }
        kinds.push(schema.type)
    }
    return { type: kinds }
}

/** String literals under `string`, number literals under `number`: one `enum` each. */
function literalGroups(literals: Type[]): Schema[] {
    const strings: Type[] = []
    const numbers: Type[] = []
    for (const literal of literals)
        (literal.flags & TypeFlags.StringLiteral ? strings : numbers).push(
            literal,
        )
    const groups: Schema[] = []
    if (strings.length > 0) groups.push(literalsOf(strings))
    if (numbers.length > 0) groups.push(literalsOf(numbers))
    return groups
}

function literalsOf(literals: Type[]): Schema {
    const values: JsonValue[] = []
    for (const literal of literals)
        values.push((literal as LiteralType).value as string | number)
    const kind =
        (literals[0] as Type).flags & TypeFlags.StringLiteral
            ? 'string'
            : 'number'
    return values.length === 1
        ? { type: kind, const: values[0] as JsonValue }
        : { type: kind, enum: values }
}

async function holdsUndefined(type: Type): Promise<boolean> {
    if (type.flags & (TypeFlags.Undefined | TypeFlags.Void)) return true
    if (!(type.flags & TypeFlags.Union)) return false
    for (const member of await (type as UnionOrIntersectionType).getTypes())
        if (member.flags & (TypeFlags.Undefined | TypeFlags.Void)) return true
    return false
}
