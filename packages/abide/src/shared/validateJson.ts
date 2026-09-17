// THE NATIVE VALIDATOR. A `JsonSchema` is the form abide can generate, publish and read
// back (19.8, 20.6), so it is the one form that cannot be delegated to a library an app
// happens to have — the OpenAPI document and the MCP tool description are the same
// document this validates against.
//
// AN UNKNOWN KEYWORD THROWS, and that is the decision worth stating. The alternative —
// ignoring what is not implemented — is a schema that declares a constraint and silently
// does not apply it, which is the failure a validation layer must not have: the app reads
// its own declaration and believes the data was checked. Throwing is loud, lands at the
// author, and is fixed by implementing the keyword.
//
// ANNOTATIONS ARE NOT CONSTRAINTS and are skipped rather than refused: `title`,
// `description`, `default` and the rest say nothing about whether a value is valid, and a
// generated document carries them.

import type { Issues } from './Issues.ts'
import type { JsonValue } from './JsonValue.ts'

type Node = { [key: string]: JsonValue }

// Read but not checked — see the header. `$schema` and `$id` identify the document,
// the rest are for a human or a generated page.
const ANNOTATIONS = new Set([
    '$schema',
    '$id',
    '$comment',
    'title',
    'description',
    'default',
    'examples',
    'deprecated',
    'readOnly',
    'writeOnly',
])

const CONSTRAINTS = new Set([
    'type',
    'enum',
    'const',
    'required',
    'properties',
    'additionalProperties',
    'items',
    'minItems',
    'maxItems',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'pattern',
    'anyOf',
    'allOf',
    'oneOf',
    'not',
    'nullable',
])

export function validateJson<T>(
    schema: JsonValue,
    value: unknown,
): Issues<T> | null {
    const found: Record<string, string[]> = {}
    check(schema, value, '', found)
    for (const _key in found) return found as Issues<T>
    return null
}

function note(
    found: Record<string, string[]>,
    path: string,
    said: string,
): void {
    const standing = found[path]
    if (standing === undefined) found[path] = [said]
    else standing.push(said)
}

function join(path: string, key: string): string {
    return path === '' ? key : `${path}.${key}`
}

function typeName(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    const held = typeof value
    if (held === 'number') return Number.isInteger(value) ? 'integer' : 'number'
    return held
}

function matchesType(wanted: string, value: unknown): boolean {
    // An `integer` is a `number` that happens to be whole, and a whole `number` satisfies
    // both — which is JSON Schema's own reading and not a convenience here.
    if (wanted === 'integer')
        return typeof value === 'number' && Number.isInteger(value)
    if (wanted === 'number') return typeof value === 'number'
    return typeName(value) === wanted
}

function sameJson(a: unknown, b: unknown): boolean {
    // `const` and `enum` compare by VALUE, so a nested object has to be walked. The
    // canonical form is not reachable from here (it is a `#shared` sibling that would drag
    // its own graph in for one comparison), and a schema's `const` is small by nature.
    if (a === b) return true
    if (a === null || b === null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false
    const left = JSON.stringify(a)
    const right = JSON.stringify(b)
    return left === right
}

function check(
    schema: JsonValue,
    value: unknown,
    path: string,
    found: Record<string, string[]>,
): void {
    // `true` accepts anything and `false` accepts nothing, which is JSON Schema's boolean
    // form and is what an `additionalProperties: false` hands down to this walk.
    if (schema === true) return
    if (schema === false) {
        note(found, path, 'is not allowed here')
        return
    }
    if (
        schema === null ||
        typeof schema !== 'object' ||
        Array.isArray(schema)
    ) {
        throw new Error(
            `validateJson was given ${typeName(schema)} where a schema object was expected, at ${path === '' ? 'the root' : path}.`,
        )
    }
    const node = schema as Node

    for (const keyword in node) {
        if (ANNOTATIONS.has(keyword) || CONSTRAINTS.has(keyword)) continue
        throw new Error(
            `validateJson does not implement the JSON Schema keyword "${keyword}" (at ${path === '' ? 'the root' : path}). A declared constraint that is not applied is worse than one that is refused.`,
        )
    }

    // `nullable` is OpenAPI's spelling and abide generates OpenAPI (20.6), so it is read
    // here rather than left to leak through as an unknown keyword.
    if (node.nullable === true && value === null) return

    const wanted = node.type
    if (typeof wanted === 'string' && !matchesType(wanted, value)) {
        note(found, path, `must be ${wanted}, was ${typeName(value)}`)
        return
    }
    if (Array.isArray(wanted)) {
        let matched = false
        for (const one of wanted)
            if (typeof one === 'string' && matchesType(one, value))
                matched = true
        if (!matched) {
            note(
                found,
                path,
                `must be one of ${wanted.join(', ')}, was ${typeName(value)}`,
            )
            return
        }
    }

    if ('const' in node && !sameJson(node.const, value))
        note(found, path, `must be ${JSON.stringify(node.const)}`)

    if (Array.isArray(node.enum)) {
        let matched = false
        for (const one of node.enum) if (sameJson(one, value)) matched = true
        if (!matched)
            note(
                found,
                path,
                `must be one of ${node.enum.map((one) => JSON.stringify(one)).join(', ')}`,
            )
    }

    if (typeof value === 'number') checkNumber(node, value, path, found)
    if (typeof value === 'string') checkString(node, value, path, found)
    if (Array.isArray(value)) checkArray(node, value, path, found)
    if (value !== null && typeof value === 'object' && !Array.isArray(value))
        checkObject(node, value as Record<string, unknown>, path, found)

    checkCombinators(node, value, path, found)
}

function checkNumber(
    node: Node,
    value: number,
    path: string,
    found: Record<string, string[]>,
): void {
    if (typeof node.minimum === 'number' && value < node.minimum)
        note(found, path, `must be at least ${node.minimum}`)
    if (typeof node.maximum === 'number' && value > node.maximum)
        note(found, path, `must be at most ${node.maximum}`)
    if (
        typeof node.exclusiveMinimum === 'number' &&
        value <= node.exclusiveMinimum
    )
        note(found, path, `must be greater than ${node.exclusiveMinimum}`)
    if (
        typeof node.exclusiveMaximum === 'number' &&
        value >= node.exclusiveMaximum
    )
        note(found, path, `must be less than ${node.exclusiveMaximum}`)
}

function checkString(
    node: Node,
    value: string,
    path: string,
    found: Record<string, string[]>,
): void {
    if (typeof node.minLength === 'number' && value.length < node.minLength)
        note(found, path, `must be at least ${node.minLength} characters`)
    if (typeof node.maxLength === 'number' && value.length > node.maxLength)
        note(found, path, `must be at most ${node.maxLength} characters`)
    if (
        typeof node.pattern === 'string' &&
        !new RegExp(node.pattern).test(value)
    )
        note(found, path, `must match ${node.pattern}`)
}

function checkArray(
    node: Node,
    value: unknown[],
    path: string,
    found: Record<string, string[]>,
): void {
    if (typeof node.minItems === 'number' && value.length < node.minItems)
        note(found, path, `must have at least ${node.minItems} items`)
    if (typeof node.maxItems === 'number' && value.length > node.maxItems)
        note(found, path, `must have at most ${node.maxItems} items`)
    const items = node.items
    if (items === undefined) return
    for (let index = 0; index < value.length; index += 1)
        check(items, value[index], join(path, String(index)), found)
}

function checkObject(
    node: Node,
    value: Record<string, unknown>,
    path: string,
    found: Record<string, string[]>,
): void {
    const required = node.required
    if (Array.isArray(required)) {
        for (const key of required) {
            // ABSENT RATHER THAN FALSY: a required member holding `null`, `0` or `''` is
            // present, and a check written as a truthiness test refuses exactly the values
            // an author meant to allow.
            if (typeof key === 'string' && !(key in value))
                note(found, join(path, key), 'is required')
        }
    }
    const properties = node.properties
    const declared =
        properties !== null &&
        typeof properties === 'object' &&
        !Array.isArray(properties)
            ? (properties as Node)
            : null
    if (declared !== null) {
        for (const key in declared) {
            // An absent member is `required`'s business, not its schema's — checking it
            // here would report every optional member as the wrong type.
            if (!(key in value)) continue
            check(
                declared[key] as JsonValue,
                value[key],
                join(path, key),
                found,
            )
        }
    }
    const extra = node.additionalProperties
    if (extra === undefined) return
    for (const key in value) {
        if (declared !== null && key in declared) continue
        if (extra === false) {
            note(found, join(path, key), 'is not a known member')
            continue
        }
        check(extra, value[key], join(path, key), found)
    }
}

function checkCombinators(
    node: Node,
    value: unknown,
    path: string,
    found: Record<string, string[]>,
): void {
    // A COMBINATOR'S BRANCHES ARE TRIED IN A SCRATCH RECORD, so a branch that failed
    // leaves nothing behind: `anyOf` succeeding on its second arm must not report the
    // first arm's complaints, which is what walking straight into `found` would do.
    if (Array.isArray(node.anyOf)) {
        let matched = false
        for (const one of node.anyOf) {
            const attempt: Record<string, string[]> = {}
            check(one, value, path, attempt)
            let clean = true
            for (const _key in attempt) clean = false
            if (clean) matched = true
        }
        if (!matched)
            note(found, path, 'does not match any of the allowed shapes')
    }
    if (Array.isArray(node.oneOf)) {
        let matched = 0
        for (const one of node.oneOf) {
            const attempt: Record<string, string[]> = {}
            check(one, value, path, attempt)
            let clean = true
            for (const _key in attempt) clean = false
            if (clean) matched += 1
        }
        if (matched !== 1)
            note(
                found,
                path,
                `must match exactly one of the allowed shapes, matched ${matched}`,
            )
    }
    if (Array.isArray(node.allOf))
        for (const one of node.allOf) check(one, value, path, found)
    if (node.not !== undefined) {
        const attempt: Record<string, string[]> = {}
        check(node.not, value, path, attempt)
        let clean = true
        for (const _key in attempt) clean = false
        if (clean) note(found, path, 'matches a shape that is not allowed')
    }
}
