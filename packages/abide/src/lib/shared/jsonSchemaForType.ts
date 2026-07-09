import ts from 'typescript'

const STRINGISH_FLAGS =
    ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping
const NUMERIC_FLAGS = ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral
const NULLISH_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void
const OPTIONALITY_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Void

/*
Projects a `ts.Type` to a JSON Schema (ADR-0030 D2) — the complement of jsonSchemaForSchema, which
projects a runtime VALIDATOR. This projects a bare typed handler return so an rpc's OpenAPI 200 / MCP
outputSchema is generated from the handler's return type when no `schemas.output` validator is
declared. Covers the subset abide's `json()`/`jsonl()` actually emit (primitives, literals, objects,
arrays, tuples, unions, Date, records). Returns the same `Record<string, unknown>` shape
jsonSchemaForSchema does, so the projected schema is drop-in for every surface.

Fails OPEN: an unsupported / unresolvable type projects to `{}` (permissive "any JSON") and, at the
top level, a bare `{}` collapses to undefined so the surface omits the schema — exactly today's
behavior with no `schemas.output`. Never throws, so a projection gap can't break a build. The `seen`
set guards a recursive type (a tree node referencing itself) from infinite-looping — a revisit
emits `{}` to break the cycle.
*/
export function jsonSchemaForType(
    checker: ts.TypeChecker,
    type: ts.Type,
): Record<string, unknown> | undefined {
    const schema = project(checker, type, new Set())
    // A bare permissive object carries no shape hint — omit it so the surface behaves as if unschema'd.
    return Object.keys(schema).length === 0 ? undefined : schema
}

/* The recursive core. Always returns a schema object (never undefined) — `{}` is the permissive
   fail-open value for anything unsupported, so every branch can compose the result inline. */
function project(
    checker: ts.TypeChecker,
    type: ts.Type,
    seen: Set<ts.Type>,
): Record<string, unknown> {
    // any/unknown carry no shape — permissive.
    if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
        return {}
    }
    if (type.isUnion()) {
        return projectUnion(checker, type, seen)
    }
    // An intersection rarely projects cleanly to a single JSON Schema — punt permissive (ADR-0030 scope).
    if (type.isIntersection()) {
        return {}
    }
    // `boolean` is a `true | false` union caught above; a lone literal / intrinsic lands here.
    if ((type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0) {
        return { type: 'boolean' }
    }
    if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
        return { type: 'string', const: (type as ts.StringLiteralType).value }
    }
    // A template-literal / mapped string projects to a plain string (its pattern isn't modeled).
    if ((type.flags & STRINGISH_FLAGS) !== 0) {
        return { type: 'string' }
    }
    if ((type.flags & NUMERIC_FLAGS) !== 0) {
        return { type: 'number' }
    }
    // JSON Schema has no bigint; matches the ADR-0029 wire representation (a bigint rides as a string).
    if ((type.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) !== 0) {
        return { type: 'string' }
    }
    if ((type.flags & ts.TypeFlags.Null) !== 0) {
        return { type: 'null' }
    }
    if ((type.flags & OPTIONALITY_FLAGS) !== 0) {
        return {}
    }
    // A function/callable body isn't JSON — punt permissive.
    if (type.getCallSignatures().length > 0) {
        return {}
    }
    const symbolName = type.getSymbol()?.name
    if (symbolName === 'Date') {
        return { type: 'string', format: 'date-time' }
    }
    if (symbolName === 'Array' || symbolName === 'ReadonlyArray') {
        return projectArray(checker, type, seen)
    }
    if (isTupleType(type)) {
        return projectTuple(checker, type, seen)
    }
    if ((type.flags & ts.TypeFlags.Object) !== 0) {
        return projectObject(checker, type, seen)
    }
    return {}
}

/*
A union projects by first stripping the `undefined`/`null`/`void` members that only encode
optionality (they make a property non-required, not a real branch). What survives: all-boolean →
`boolean`; all string-literal → `const` (one) or `enum` (many); one survivor → that member's schema;
otherwise `anyOf` of each. An all-nullish union (a bare `undefined`) has nothing to say → `{}`.
*/
function projectUnion(
    checker: ts.TypeChecker,
    type: ts.UnionType,
    seen: Set<ts.Type>,
): Record<string, unknown> {
    const members = type.types.filter((member) => (member.flags & NULLISH_FLAGS) === 0)
    if (members.length === 0) {
        return {}
    }
    if (members.every((member) => (member.flags & ts.TypeFlags.BooleanLiteral) !== 0)) {
        return { type: 'boolean' }
    }
    if (members.every((member) => (member.flags & ts.TypeFlags.StringLiteral) !== 0)) {
        const values = members.map((member) => (member as ts.StringLiteralType).value)
        return values.length === 1 ? { type: 'string', const: values[0] } : { enum: values }
    }
    if (members.length === 1) {
        return project(checker, members[0], seen)
    }
    seen.add(type)
    const anyOf = members.map((member) => project(checker, member, seen))
    seen.delete(type)
    return { anyOf }
}

/* `T[]`/`readonly T[]` → `{ type: 'array', items: project(T) }`. */
function projectArray(
    checker: ts.TypeChecker,
    type: ts.Type,
    seen: Set<ts.Type>,
): Record<string, unknown> {
    const element = checker.getTypeArguments(type as ts.TypeReference)[0]
    seen.add(type)
    const items = element === undefined ? {} : project(checker, element, seen)
    seen.delete(type)
    return { type: 'array', items }
}

/* A fixed-length tuple → positional `prefixItems`, `items: false` to forbid extras (JSON Schema
   2020-12 / OpenAPI 3.1 tuple encoding). */
function projectTuple(
    checker: ts.TypeChecker,
    type: ts.Type,
    seen: Set<ts.Type>,
): Record<string, unknown> {
    seen.add(type)
    const prefixItems = checker
        .getTypeArguments(type as ts.TypeReference)
        .map((element) => project(checker, element, seen))
    seen.delete(type)
    return { type: 'array', prefixItems, items: false }
}

/*
An object type → `{ type: 'object', properties, required }`. A property is required unless it is `?`
optional or its type bears `undefined`. A string index signature (`Record<string, V>` / `{ [k]: V }`)
becomes `additionalProperties: project(V)`. The `seen` guard short-circuits a self-referential type
(a recursive tree node) to `{}` so it can't infinite-loop.
*/
function projectObject(
    checker: ts.TypeChecker,
    type: ts.Type,
    seen: Set<ts.Type>,
): Record<string, unknown> {
    if (seen.has(type)) {
        return {}
    }
    seen.add(type)
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const symbol of checker.getPropertiesOfType(type)) {
        const propertyType = typeOfProperty(checker, symbol)
        const name = symbol.getName()
        properties[name] = project(checker, propertyType, seen)
        const optional =
            (symbol.flags & ts.SymbolFlags.Optional) !== 0 || bearsUndefined(propertyType)
        if (!optional) {
            required.push(name)
        }
    }
    const indexType = checker.getIndexTypeOfType(type, ts.IndexKind.String)
    seen.delete(type)
    const schema: Record<string, unknown> = { type: 'object' }
    if (Object.keys(properties).length > 0) {
        schema.properties = properties
    }
    if (required.length > 0) {
        schema.required = required
    }
    if (indexType !== undefined) {
        schema.additionalProperties = project(checker, indexType, seen)
    }
    return schema
}

/* A property symbol's type — from its declaration when it has one (the common case), else the
   checker's symbol-level type (a synthesized/index property). */
function typeOfProperty(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    return declaration === undefined
        ? checker.getTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, declaration)
}

/* True when a property's type includes `undefined`/`void` — an implicit optional even without `?`. */
function bearsUndefined(type: ts.Type): boolean {
    if (type.isUnion()) {
        return type.types.some((member) => (member.flags & OPTIONALITY_FLAGS) !== 0)
    }
    return (type.flags & OPTIONALITY_FLAGS) !== 0
}

/* A tuple is a TypeReference whose target (an ObjectType) carries the Tuple object flag. */
function isTupleType(type: ts.Type): boolean {
    const target = (type as ts.TypeReference).target as ts.ObjectType | undefined
    return target !== undefined && (target.objectFlags & ts.ObjectFlags.Tuple) !== 0
}
