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
import { isRecord } from './isRecord.ts'
import type { JsonValue } from './JsonValue.ts'
import { note } from './note.ts'

type Node = { [key: string]: JsonValue }

// THE SHAPE IS A FACT ABOUT THE SCHEMA, NOT ABOUT THE VALUE, and `check` below is re-entered per
// element and per combinator branch — so the sweep re-proved the same `items` node once a row.
const VERIFIED = new WeakSet<object>()

// WHERE AN ISSUE GOES, and `null` is a combinator's SCRATCH ATTEMPT: a branch whose issues are
// only ever counted, never read. A record per branch per value was the whole of what `anyOf`,
// `oneOf` and `not` allocated beyond the walk itself: 83-90% of the time without it in V8 and
// 78-88% in JSC, and the walk is 86-99% of a gated write (`harness/scripts/sharedCases.ts`).
type Report = Record<string, string[]> | null

// Set by any issue noted into a scratch attempt. ONE FLAG, SAVED AROUND EACH ATTEMPT, because an
// attempt nests: an `anyOf` inside a `oneOf` branch clears it for its own branches, and without
// the restore a nested success would erase the outer branch's failure.
let mismatched = false

function noteOr(found: Report, path: string, said: string): void {
    if (found === null) mismatched = true
    else note(found, path, said)
}

// A COMBINATOR'S BRANCHES ARE TRIED APART FROM `found`, so a branch that failed leaves nothing
// behind: `anyOf` succeeding on its second arm must not report the first arm's complaints.
function fails(schema: JsonValue, value: unknown, path: string): boolean {
    const outer = mismatched
    mismatched = false
    check(schema, value, path, null)
    const failed = mismatched
    mismatched = outer
    return failed
}

// THE HEADER'S RULE, APPLIED ONE LEVEL DOWN. An unknown KEYWORD throws, and so does a known one
// holding a value this cannot read: skipped, it is a declared constraint silently not applied.
// `{minimum: 5, exclusiveMinimum: true}` is the case that matters — draft-04's spelling of a strict
// bound, where 20.6 publishes the one holding a NUMBER — and `{required: "a"}` or `{anyOf: {}}`
// otherwise validate nothing.
function verifyShape(node: Node, path: string): void {
    for (const keyword in node) {
        if (!Object.hasOwn(node, keyword)) continue
        if (ANNOTATIONS.has(keyword)) continue
        const shape = CONSTRAINTS.get(keyword)
        // THE NAME IS CHECKED BEFORE THE VALUE, and the order is the whole of it: a misspelled
        // keyword is unknown whatever it holds, and `{minimun: options.min}` with no `min` on the
        // options carries `undefined` — so skipping the undefined value FIRST let the typo
        // through silently, which is the one failure this module exists to prevent.
        if (shape === undefined)
            throw new Error(
                `validateJson does not implement the JSON Schema keyword "${keyword}" (at ${placeOf(path)}). A declared constraint that is not applied is worse than one that is refused.`,
            )
        // AN ABSENT KEYWORD IS SPELLED `undefined` HALF THE TIME IT IS WRITTEN: `{type: 'number',
        // minimum: options.min}` is ordinary schema construction, and the shape check read it as
        // a number that was not one and refused every write against that schema on the `''` entry.
        // The value the keyword does not have is the value it does not constrain.
        if (node[keyword] === undefined) continue
        if (!hasShape(shape, node[keyword]))
            throw wrongShape(keyword, node[keyword], shape, path)
    }
}

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

// EVERY CONSTRAINT KEYWORD AND THE SHAPE ITS VALUE MUST HAVE. One table rather than an allow-list
// beside a ladder of guards: a keyword admitted here without a shape is the "declared but not
// applied" failure the header exists to stop, and the two lists had nothing holding them together.
//
// THE SHAPE IS CHECKED WHERE THE KEYWORD STANDS, not where its check happens to run. Read inside
// `checkNumber` / `checkObject`, the refusal was DATA-dependent: `{minimum: 5, exclusiveMinimum:
// true}` — the draft-04 spelling 20.6 replaced — validated a string or a null with no complaint
// and threw only the first time an actual number arrived, so a malformed schema passed every test
// that did not happen to feed it one. `{required: "a"}`, `{enum: "a"}`, `{type: 42}`, `{anyOf: {}}`
// and `{properties: []}` each walked past an `Array.isArray` and validated NOTHING at all.
//
// SO EVERY READ BELOW IS A CAST AND AN `undefined` TEST. A second shape test where a keyword is
// applied is a branch nothing reaches and a second owner of the question this table answers.
type Shape =
    | 'a number'
    | 'a string'
    | 'a boolean'
    | 'an array of names'
    | 'an array'
    | 'a schema'
    | 'an array of schemas'
    | 'an object of schemas'
    | 'a string or an array of them'
    | 'any value'

const CONSTRAINTS = new Map<string, Shape>([
    ['type', 'a string or an array of them'],
    ['enum', 'an array'],
    ['const', 'any value'],
    ['required', 'an array of names'],
    ['properties', 'an object of schemas'],
    ['additionalProperties', 'a schema'],
    ['items', 'a schema'],
    ['minItems', 'a number'],
    ['maxItems', 'a number'],
    ['minimum', 'a number'],
    ['maximum', 'a number'],
    ['exclusiveMinimum', 'a number'],
    ['exclusiveMaximum', 'a number'],
    ['minLength', 'a number'],
    ['maxLength', 'a number'],
    ['pattern', 'a string'],
    ['anyOf', 'an array of schemas'],
    ['allOf', 'an array of schemas'],
    ['oneOf', 'an array of schemas'],
    ['not', 'a schema'],
    ['nullable', 'a boolean'],
])

// Whether a value has the shape its keyword declares. A `schema` is `true`, `false` or an object —
// `check` refuses anything else where it walks into one, so it is not re-stated here.
function hasShape(shape: Shape, held: unknown): boolean {
    switch (shape) {
        case 'a number':
            return typeof held === 'number'
        case 'a string':
            return typeof held === 'string'
        case 'a boolean':
            return typeof held === 'boolean'
        case 'an array of names':
            return (
                Array.isArray(held) &&
                held.every((one) => typeof one === 'string')
            )
        case 'an array':
        case 'an array of schemas':
            return Array.isArray(held)
        case 'a schema':
            return typeof held === 'boolean' || isRecord(held)
        case 'an object of schemas':
            return isRecord(held)
        case 'a string or an array of them':
            return (
                typeof held === 'string' ||
                (Array.isArray(held) &&
                    held.every((one) => typeof one === 'string'))
            )
        case 'any value':
            return true
    }
}

export function validateJson<T>(
    schema: JsonValue,
    value: unknown,
): Issues<T> | null {
    const found: Record<string, string[]> = {}
    check(schema, value, '', found)
    for (const _path in found) return found as Issues<T>
    return null
}

function join(path: string, key: string): string {
    return path === '' ? key : `${path}.${key}`
}

function typeName(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    const held = typeof value
    if (held !== 'number') return held
    // NaN AND THE INFINITIES ARE NAMED, not called `number`, because they are the values `check`
    // refuses as not JSON — `must be a JSON value, was number` would name the one thing it is not.
    if (!Number.isFinite(value)) return String(value)
    return Number.isInteger(value) ? 'integer' : 'number'
}

function matchesType(wanted: string, value: unknown): boolean {
    // An `integer` is a `number` that happens to be whole, and a whole `number` satisfies
    // both — which is JSON Schema's own reading and not a convenience here.
    if (wanted === 'integer')
        return typeof value === 'number' && Number.isInteger(value)
    // `check` has already refused a number that is not finite, so `typeof` is the whole test.
    if (wanted === 'number') return typeof value === 'number'
    return typeName(value) === wanted
}

// `const` and `enum` compare by VALUE, so a nested object has to be walked. The canonical form is
// not reachable from here (it is a `#shared` sibling that would drag its own graph in for one
// comparison), and a schema's `const` is small by nature — which also bounds this walk, because
// it stops the moment the two shapes part.
//
// WALKED RATHER THAN STRINGIFIED. `JSON.stringify(a) === JSON.stringify(b)` read as a value
// comparison and was three: it is KEY-ORDER sensitive, so `const: {a:1,b:2}` refused the same
// object sent as `{"b":2,"a":1}`; it DROPS an `undefined` member, so `{a:1,b:undefined}` compared
// equal to `{a:1}`; and it THROWS on a cyclic value, out of the validator, from input.
function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a === null || b === null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a)) {
        const other = b as unknown[]
        if (a.length !== other.length) return false
        for (let at = 0; at < a.length; at += 1)
            if (!sameJson(a[at], other[at])) return false
        return true
    }
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    let count = 0
    for (const key in left) {
        if (!Object.hasOwn(left, key)) continue
        count += 1
        if (!Object.hasOwn(right, key)) return false
        if (!sameJson(left[key], right[key])) return false
    }
    for (const key in right) {
        if (!Object.hasOwn(right, key)) continue
        count -= 1
    }
    return count === 0
}

function check(
    schema: JsonValue,
    value: unknown,
    path: string,
    found: Report,
): void {
    // `true` accepts anything and `false` accepts nothing, which is JSON Schema's boolean
    // form and is what an `additionalProperties: false` hands down to this walk.
    if (schema === true) return
    if (schema === false) {
        noteOr(found, path, 'is not allowed here')
        return
    }
    if (
        schema === null ||
        typeof schema !== 'object' ||
        Array.isArray(schema)
    ) {
        throw new Error(
            `validateJson was given ${typeName(schema)} where a schema object was expected, at ${placeOf(path)}.`,
        )
    }
    const node = schema as Node

    // MARKED ONLY ONCE THE SHAPE HOLDS: a node marked before a throw skipped the check on every
    // later call, so a typo refused the first write and let the second through unread.
    if (!VERIFIED.has(node)) {
        verifyShape(node, path)
        VERIFIED.add(node)
    }

    // NaN AND THE INFINITIES ARE NOT JSON VALUES — the invariant `canonicalKey` holds at the reach
    // (11.65) — so they are refused ONCE, here, whatever the node declares. Refused per keyword
    // they leaked past every one-sided test: `NaN < 0` and `NaN > 100` are both false, and
    // `-Infinity` passes `maximum` as readily as `Infinity` passes `minimum`, so `{maximum: 100}`
    // accepted `-Infinity` with no issue while the NaN beside it was caught by a tail check.
    if (typeof value === 'number' && !Number.isFinite(value)) {
        noteOr(found, path, `must be a JSON value, was ${typeName(value)}`)
        return
    }

    // `nullable` is OpenAPI's older spelling. It WIDENS THE TYPE and nothing else: returning here
    // skipped `const`, `enum`, `not` and every combinator, so `{nullable: true, enum: ['a']}`
    // accepted `null` against its own enumeration and `{nullable: true, not: {type: 'null'}}`
    // accepted the one value it forbids.
    const nullWidened = node.nullable === true && value === null
    const wanted = node.type
    if (!nullWidened) {
        if (typeof wanted === 'string' && !matchesType(wanted, value)) {
            noteOr(found, path, `must be ${wanted}, was ${typeName(value)}`)
            return
        }
        if (Array.isArray(wanted)) {
            let matched = false
            for (const one of wanted)
                if (matchesType(one as string, value)) {
                    matched = true
                    break
                }
            if (!matched) {
                noteOr(
                    found,
                    path,
                    `must be one of ${wanted.join(', ')}, was ${typeName(value)}`,
                )
                return
            }
        }
    }

    if (node.const !== undefined && !sameJson(node.const, value))
        noteOr(found, path, `must be ${JSON.stringify(node.const)}`)

    const enumerated = node.enum as JsonValue[] | undefined
    if (enumerated !== undefined) {
        let matched = false
        for (const one of enumerated)
            if (sameJson(one, value)) {
                matched = true
                break
            }
        if (!matched)
            noteOr(
                found,
                path,
                `must be one of ${enumerated.map((one) => JSON.stringify(one)).join(', ')}`,
            )
    }

    if (typeof value === 'number') checkNumber(node, value, path, found)
    if (typeof value === 'string') checkString(node, value, path, found)
    if (Array.isArray(value)) checkArray(node, value, path, found)
    if (isRecord(value)) checkObject(node, value, path, found)

    checkCombinators(node, value, path, found)
}

// Where in the document a refusal of the validator's own input stands, for its message.
function placeOf(path: string): string {
    return path === '' ? 'the root' : path
}

// ONE SENTENCE FOR ONE FAILURE, and every keyword reads through it.
function wrongShape(
    keyword: string,
    held: unknown,
    wanted: Shape,
    path: string,
): Error {
    return new Error(
        `validateJson was given ${typeName(held)} for "${keyword}" (at ${placeOf(path)}), where ${wanted} was expected. A declared constraint that cannot be applied is worse than one that is refused.`,
    )
}

function checkNumber(
    node: Node,
    value: number,
    path: string,
    found: Report,
): void {
    const minimum = node.minimum as number | undefined
    if (minimum !== undefined && value < minimum)
        noteOr(found, path, `must be at least ${minimum}`)
    const maximum = node.maximum as number | undefined
    if (maximum !== undefined && value > maximum)
        noteOr(found, path, `must be at most ${maximum}`)
    const above = node.exclusiveMinimum as number | undefined
    if (above !== undefined && value <= above)
        noteOr(found, path, `must be greater than ${above}`)
    const below = node.exclusiveMaximum as number | undefined
    if (below !== undefined && value >= below)
        noteOr(found, path, `must be less than ${below}`)
}

function checkString(
    node: Node,
    value: string,
    path: string,
    found: Report,
): void {
    const shortest = node.minLength as number | undefined
    if (shortest !== undefined && value.length < shortest)
        noteOr(found, path, `must be at least ${shortest} characters`)
    const longest = node.maxLength as number | undefined
    if (longest !== undefined && value.length > longest)
        noteOr(found, path, `must be at most ${longest} characters`)
    const pattern = node.pattern as string | undefined
    if (pattern === undefined) return
    if (!matcherFor(pattern, path).test(value))
        noteOr(found, path, `must match ${pattern}`)
}

// COMPILED ONCE PER SOURCE, not once per value: `items: {pattern}` put a `new RegExp` on every
// element of the array, the same source string recompiled down its whole length. The key space is
// the set of `pattern` strings the app's own schemas carry, so it is bounded by the source.
const MATCHERS = new Map<string, RegExp>()

function matcherFor(pattern: string, path: string): RegExp {
    const standing = MATCHERS.get(pattern)
    if (standing !== undefined) return standing
    let made: RegExp
    try {
        made = new RegExp(pattern)
    } catch (thrown) {
        // A bad pattern is the author's, and it arrived as a `SyntaxError` naming neither the
        // schema nor where in it — from a path that anything reaching validation walks.
        throw new Error(
            `validateJson cannot read the "pattern" ${JSON.stringify(pattern)} (at ${placeOf(path)}): ${(thrown as Error).message}`,
        )
    }
    MATCHERS.set(pattern, made)
    return made
}

function checkArray(
    node: Node,
    value: unknown[],
    path: string,
    found: Report,
): void {
    const fewest = node.minItems as number | undefined
    if (fewest !== undefined && value.length < fewest)
        noteOr(found, path, `must have at least ${fewest} items`)
    const most = node.maxItems as number | undefined
    if (most !== undefined && value.length > most)
        noteOr(found, path, `must have at most ${most} items`)
    const items = node.items
    if (items === undefined) return
    for (let index = 0; index < value.length; index += 1)
        check(items, value[index], join(path, String(index)), found)
}

function checkObject(
    node: Node,
    value: Record<string, unknown>,
    path: string,
    found: Report,
): void {
    const required = node.required as string[] | undefined
    if (required !== undefined) {
        for (const key of required) {
            // ABSENT RATHER THAN FALSY: a required member holding `null`, `0` or `''` is
            // present, and a check written as a truthiness test refuses exactly the values
            // an author meant to allow.
            //
            // OWN RATHER THAN `in`, here and everywhere below. `in` walks the prototype chain,
            // and every one of the twelve names on `Object.prototype` is a key JSON can carry:
            // `required: ['toString']` was satisfied by `{}`, and — the one that matters —
            // `'__proto__' in declared` answered true, so `additionalProperties: false` accepted
            // `{"__proto__": …}` as a declared member and handed the object on unchecked.
            if (!Object.hasOwn(value, key))
                noteOr(found, join(path, key), 'is required')
        }
    }
    const properties = node.properties
    const declared = properties === undefined ? null : (properties as Node)
    if (declared !== null) {
        for (const key in declared) {
            if (!Object.hasOwn(declared, key)) continue
            // An absent member is `required`'s business, not its schema's — checking it
            // here would report every optional member as the wrong type.
            if (!Object.hasOwn(value, key)) continue
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
        if (!Object.hasOwn(value, key)) continue
        if (declared !== null && Object.hasOwn(declared, key)) continue
        if (extra === false) {
            noteOr(found, join(path, key), 'is not a known member')
            continue
        }
        check(extra, value[key], join(path, key), found)
    }
}

function checkCombinators(
    node: Node,
    value: unknown,
    path: string,
    found: Report,
): void {
    const anyOf = node.anyOf as JsonValue[] | undefined
    if (anyOf !== undefined) {
        let matched = false
        for (const one of anyOf) {
            if (!fails(one, value, path)) {
                matched = true
                break
            }
        }
        if (!matched)
            noteOr(found, path, 'does not match any of the allowed shapes')
    }
    const oneOf = node.oneOf as JsonValue[] | undefined
    if (oneOf !== undefined) {
        let matched = 0
        for (const one of oneOf) {
            if (!fails(one, value, path)) matched += 1
        }
        if (matched !== 1)
            noteOr(
                found,
                path,
                `must match exactly one of the allowed shapes, matched ${matched}`,
            )
    }
    const allOf = node.allOf as JsonValue[] | undefined
    if (allOf !== undefined)
        for (const one of allOf) check(one, value, path, found)
    if (node.not !== undefined) {
        if (!fails(node.not, value, path))
            noteOr(found, path, 'matches a shape that is not allowed')
    }
}
