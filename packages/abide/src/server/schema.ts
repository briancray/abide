// The declared shape of what crosses a transport, and the one representation it is declared in.
//
// A declaration is checked at the one place every door leads to: an rpc's shape is enforced in the
// memo's BODY, so the wire call, the in-process call and a handler another handler reaches all hit
// the same gate — there is no door that could be added later and forget to. A socket's is enforced
// at the wire, which is the only place a message arrives from outside the process at all.
//
// Three forms, and no dependency:
//
//   JsonSchema        the NATIVE one. What the compiler derives from a type annotation, what a
//                     projection publishes, and what a caller writes by hand when it wants both.
//   a plain function  the zero-ceremony one: return the value you accept and THROW what you refuse,
//                     which is what a hand-written parse already is. Synchronous by that contract —
//                     there is nowhere in a throw to put a promise.
//   Standard Schema   the interop one, a SPEC that zod, valibot and arktype all answer to. abide
//                     declares the interface here and imports none of them.
//
// The last two VALIDATE and say nothing a machine can read, so an endpoint declared with one is
// published with the shape the compiler derived from its type instead. That asymmetry is the whole
// reason JSON Schema is the native form rather than a projection of something else.

import { isFile, isThenable, messageOf } from '#shared/internal/probes.ts'
import type { JsonSchema, JsonType } from '#shared/internal/shapes.ts'
import { type Failed, HttpError } from '#shared/internal/wire.ts'

export type { EndpointShape, JsonSchema, JsonType, Shapes } from '#shared/internal/shapes.ts'

/**
 * The Standard Schema interface, version 1 — declared, not imported.
 *
 * Only the members abide reads are named: `validate` and the version tag a library brands itself
 * with. `types` is carried because that is where a library puts the inferred output, and leaving it
 * out would make a real schema fail to match this shape structurally.
 */
export interface StandardSchemaV1<Output = unknown> {
    readonly '~standard': {
        readonly version: 1
        readonly vendor: string
        readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>
        readonly types?: { readonly input: unknown; readonly output: Output } | undefined
    }
}

interface StandardIssue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

type StandardResult<T> =
    | { readonly value: T; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<StandardIssue> }

/** A declared shape, in any of the three forms. */
export type Schema<T> = ((value: unknown) => T) | StandardSchemaV1<T> | JsonSchema

/**
 * What a refusal names. Read at the THROW rather than captured, because the address is a fact about
 * the file and a declaration does not know which file it is in until its module registers.
 */
interface Named {
    readonly address: string
}

/** A shape, ready to check. Returns the validated value — a schema may normalise as well as refuse. */
export type Gate<T> = (value: unknown) => T | Promise<T>

/** The one name a shape refusal travels under, on either side of a wire. */
export const SCHEMA_ERROR = 'AbideSchemaError'

/**
 * That refusal as it is CAUGHT — the name, and every issue the walk found as the payload.
 *
 * In the refusal union of every declaration (`rpc.ts`'s `Declared`) rather than something an author
 * adds, because every endpoint has this door: a shape nobody declared is still the one the compiler
 * derived from the handler's type. So `fn(args).isError(e, SCHEMA_ERROR)` narrows `e.data` to the
 * issues without anything being written twice.
 */
export type SchemaRefusal = Failed<typeof SCHEMA_ERROR, readonly Issue[]>

/** Which of the three a declaration is. A function is not an object; the other two differ by tag. */
function isStandard(schema: object): schema is StandardSchemaV1<unknown> {
    return '~standard' in schema
}

/**
 * Is this shape one a machine can read?
 *
 * Only the native form is. A validator and a library schema both answer "does this match" and
 * neither answers "what is it", which is exactly why the compiler derives the published shape from
 * the type rather than from the declaration.
 */
export function publishable<T>(schema: Schema<T> | undefined): JsonSchema | null {
    if (schema === undefined || typeof schema === 'function' || isStandard(schema)) return null
    return schema
}

/**
 * The gate for one declared shape, built ONCE at declaration.
 *
 * `null` when nothing was declared, and that null is the whole cost of this feature to an endpoint
 * that declares no shape: one compare against `null` on the path, and no closure allocated for it.
 */
export function gate<T>(
    schema: Schema<T> | undefined,
    what: string,
    status: number,
    named: Named,
): Gate<T> | null {
    if (schema === undefined) return null
    if (typeof schema === 'function') {
        return (value: unknown): T => {
            try {
                return schema(value)
            } catch (cause) {
                // The one form with nowhere to put a path: a hand-written parse throws a sentence.
                // Still an issue LIST, so what a caller reads off a refusal is one shape whichever
                // of the three doors refused it.
                throw refused(named, what, [{ path: '', message: messageOf(cause) }], status, cause)
            }
        }
    }
    if (isStandard(schema)) {
        const validate = schema['~standard'].validate
        return (value: unknown): T | Promise<T> => {
            const result = validate(value)
            // Guarded, not awaited: a schema over a plain object settles in the call, and an
            // unconditional await would cost a promise wrap and a microtask tick per call.
            if (isThenable(result)) return result.then((settled) => taken(settled, named, what, status))
            return taken(result as StandardResult<T>, named, what, status)
        }
    }
    return (value: unknown): T => {
        const issues = validateJson(schema, value)
        if (issues === null) return value as T
        throw refused(named, what, issues, status)
    }
}

function taken<T>(result: StandardResult<T>, named: Named, what: string, status: number): T {
    if (result.issues === undefined) return result.value
    throw refused(named, what, result.issues.map(flattened), status)
}

// --- the validator -----------------------------------------------------------
//
// The subset `shapes.ts` enumerates, and nothing else. It does no coercion: a type annotation said
// what it said, and a gate that quietly turned `"3"` into `3` would make the shape a lie in the one
// document a machine reads before calling.

export interface Issue {
    path: string
    message: string
}

/**
 * `null` when it matches.
 *
 * TWO walks on a refusal and one on a match: `check` short-circuits at the first mismatch when it
 * has nowhere to write, so the path everything takes allocates nothing at all, and the second walk —
 * which collects every issue, because a caller fixing its call wants all of them — runs only where an
 * HTTP error response was about to be built anyway.
 */
export function validateJson(schema: JsonSchema, value: unknown): Issue[] | null {
    if (check(schema, value, '', null)) return null
    const issues: Issue[] = []
    check(schema, value, '', issues)
    return issues
}

function fail(issues: Issue[] | null, path: string, message: string): boolean {
    if (issues === null) return false
    issues.push({ path, message })
    return false
}

function check(schema: JsonSchema, value: unknown, path: string, issues: Issue[] | null): boolean {
    let ok = true

    const one = schema.const
    if (one !== undefined && !same(value, one)) {
        ok = fail(issues, path, `expected ${JSON.stringify(one)}`)
        if (issues === null) return false
    }

    const closed = schema.enum
    if (closed !== undefined) {
        let found = false
        for (let i = 0; i < closed.length; i++) {
            if (same(value, closed[i])) {
                found = true
                break
            }
        }
        if (!found) {
            ok = fail(issues, path, `expected one of ${closed.map((v) => JSON.stringify(v)).join(', ')}`)
            if (issues === null) return false
        }
    }

    const union = schema.anyOf ?? schema.oneOf
    if (union !== undefined) {
        let matched = false
        for (let i = 0; i < union.length; i++) {
            if (check(union[i] as JsonSchema, value, path, null)) {
                matched = true
                break
            }
        }
        if (!matched) {
            ok = fail(issues, path, 'matched none of the declared alternatives')
            if (issues === null) return false
        }
    }

    const every = schema.allOf
    if (every !== undefined) {
        for (let i = 0; i < every.length; i++) {
            if (!check(every[i] as JsonSchema, value, path, issues)) {
                ok = false
                if (issues === null) return false
            }
        }
    }

    const declared = schema.type
    if (declared === undefined) return ok
    if (typeof declared !== 'string') {
        // A union of types. Each is a whole check, because `properties` only apply under `object`.
        for (let i = 0; i < declared.length; i++) {
            if (matches(declared[i] as JsonType, schema, value)) return ok
        }
        return fail(issues, path, `expected ${declared.join(' or ')}, got ${nameOf(value)}`)
    }
    if (!isType(declared, schema, value)) {
        return fail(issues, path, `expected ${wanted(declared, schema)}, got ${nameOf(value)}`)
    }

    switch (declared) {
        case 'object':
            return members(schema, value as Record<string, unknown>, path, issues) && ok
        case 'array':
            return elements(schema, value as unknown[], path, issues) && ok
        case 'string':
            return text(schema, value as string, path, issues) && ok
        case 'number':
        case 'integer':
            return range(schema, value as number, path, issues) && ok
        default:
            return ok
    }
}

/** One alternative of a `type` union, checked whole so an object's members travel with it. */
function matches(type: JsonType, schema: JsonSchema, value: unknown): boolean {
    if (!isType(type, schema, value)) return false
    if (type === 'object') return members(schema, value as Record<string, unknown>, '', null)
    if (type === 'array') return elements(schema, value as unknown[], '', null)
    return true
}

function isType(type: JsonType, schema: JsonSchema, value: unknown): boolean {
    switch (type) {
        case 'object':
            // A FILE is `string`/`binary`, so an object here is a plain one — and a Blob reaching an
            // object slot is the mistake this catches rather than the one it lets through.
            return value !== null && typeof value === 'object' && !Array.isArray(value) && !isFile(value)

        case 'array':
            return Array.isArray(value)
        case 'string':
            // A file is the one `string` that is never text: it arrives as bytes over multipart and
            // as a `Blob` in process, and a string reaching that slot is a caller that did not send
            // the file it declared.
            if (schema.format === 'binary') return isFile(value)
            if (typeof value === 'string') return true
            // A `Date` and a `URL` ARE a string once they cross, through their own `toJSON`, and are
            // not one before they do. A wire caller encodes them and an in-process caller does not,
            // and the same declaration has to accept both — refusing what a wire call would have
            // carried is the one direction a derived shape may not err in.
            return carried(schema.format, value)
        case 'number':
            return typeof value === 'number' && Number.isFinite(value)
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value)
        case 'boolean':
            return typeof value === 'boolean'
        case 'null':
            return value === null
    }
}

/**
 * The object form of a `string` slot, for the caller that never encoded one.
 *
 * A `Date` and a `URL` become a string through their own `toJSON` on the way over and are still
 * objects before that. The PUBLISHED shape is the wire form in both cases, because that is what a
 * machine reading the document is about to send — and the gate accepts the local form beside it,
 * because refusing an in-process call that a wire call would have carried is the one way a derived
 * shape can be wrong. `binary` is not here: `isType` answers it before this is reached, since a file
 * is the one `string` for which the wire form is not text either.
 */
function carried(format: string | undefined, value: unknown): boolean {
    if (format === undefined || value === null || typeof value !== 'object') return false
    if (format === 'date-time') return value instanceof Date
    if (format === 'uri') return typeof URL !== 'undefined' && value instanceof URL
    return false
}

function wanted(type: JsonType, schema: JsonSchema): string {
    return type === 'string' && schema.format === 'binary' ? 'a file' : type
}

function members(
    schema: JsonSchema,
    value: Record<string, unknown>,
    path: string,
    issues: Issue[] | null,
): boolean {
    let ok = true
    const required = schema.required
    if (required !== undefined) {
        for (let i = 0; i < required.length; i++) {
            const name = required[i] as string
            if (value[name] === undefined) {
                ok = fail(issues, join(path, name), 'is required')
                if (issues === null) return false
            }
        }
    }
    const properties = schema.properties
    if (properties !== undefined) {
        for (const name in properties) {
            const held = value[name]
            // Absent is the optional case; `required` above is what makes absence a refusal.
            if (held === undefined) continue
            if (!check(properties[name] as JsonSchema, held, join(path, name), issues)) {
                ok = false
                if (issues === null) return false
            }
        }
    }
    const extra = schema.additionalProperties
    if (extra === undefined) return ok
    for (const name in value) {
        if (properties !== undefined && name in properties) continue
        if (extra === false) {
            ok = fail(issues, join(path, name), 'is not a declared member')
            if (issues === null) return false
            continue
        }
        if (extra === true) continue
        if (!check(extra, value[name], join(path, name), issues)) {
            ok = false
            if (issues === null) return false
        }
    }
    return ok
}

function elements(schema: JsonSchema, value: unknown[], path: string, issues: Issue[] | null): boolean {
    let ok = true
    const least = schema.minItems
    if (least !== undefined && value.length < least) {
        ok = fail(issues, path, `expected at least ${least} items`)
        if (issues === null) return false
    }
    const most = schema.maxItems
    if (most !== undefined && value.length > most) {
        ok = fail(issues, path, `expected at most ${most} items`)
        if (issues === null) return false
    }
    const item = schema.items
    if (item === undefined) return ok
    for (let i = 0; i < value.length; i++) {
        if (!check(item, value[i], `${path}[${i}]`, issues)) {
            ok = false
            if (issues === null) return false
        }
    }
    return ok
}

function text(schema: JsonSchema, value: string, path: string, issues: Issue[] | null): boolean {
    // A file is carried under `string`/`binary` and has no length or pattern to answer for.
    if (schema.format === 'binary') return true
    let ok = true
    const least = schema.minLength
    if (least !== undefined && value.length < least) {
        ok = fail(issues, path, `expected at least ${least} characters`)
        if (issues === null) return false
    }
    const most = schema.maxLength
    if (most !== undefined && value.length > most) {
        ok = fail(issues, path, `expected at most ${most} characters`)
        if (issues === null) return false
    }
    const pattern = schema.pattern
    if (pattern !== undefined && !expression(pattern).test(value)) {
        ok = fail(issues, path, `expected to match ${pattern}`)
        if (issues === null) return false
    }
    return ok
}

/**
 * A `pattern` compiled ONCE, however many values are checked against it.
 *
 * `new RegExp` per value is the one thing in this file that allocates on the matching path, and it
 * scales with the DATA rather than with the schema: five hundred rows carrying a patterned field
 * compiled the same source five hundred times. Keyed by the source string because that is what the
 * schema holds, and a schema is a document rather than an object with identity.
 */
const PATTERNS = new Map<string, RegExp>()

function expression(pattern: string): RegExp {
    let held = PATTERNS.get(pattern)
    if (held === undefined) {
        held = new RegExp(pattern)
        PATTERNS.set(pattern, held)
    }
    return held
}

function range(schema: JsonSchema, value: number, path: string, issues: Issue[] | null): boolean {
    let ok = true
    const least = schema.minimum
    if (least !== undefined && value < least) {
        ok = fail(issues, path, `expected at least ${least}`)
        if (issues === null) return false
    }
    const most = schema.maximum
    if (most !== undefined && value > most) {
        ok = fail(issues, path, `expected at most ${most}`)
        if (issues === null) return false
    }
    return ok
}

/** `Object.is`, then a structural compare for the arrays and objects an `enum` may hold. */
function same(value: unknown, expected: unknown): boolean {
    if (Object.is(value, expected)) return true
    if (value === null || expected === null) return false
    if (typeof value !== 'object' || typeof expected !== 'object') return false
    return JSON.stringify(value) === JSON.stringify(expected)
}

function join(path: string, name: string): string {
    return path === '' ? name : `${path}.${name}`
}

function nameOf(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (isFile(value)) return 'a file'
    return typeof value
}

// --- how a refusal reads -----------------------------------------------------

/** Every issue, not the first: a caller that has to fix its call wants all of what is wrong with it. */
function issueText(found: readonly Issue[]): string {
    let text = ''
    for (let i = 0; i < found.length; i++) {
        const issue = found[i] as Issue
        if (i > 0) text += '; '
        text += issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`
    }
    return text
}

/** A Standard Schema issue in the one shape the message builder reads. */
function flattened(issue: StandardIssue): Issue {
    return { path: pathText(issue.path), message: issue.message }
}

function pathText(path: StandardIssue['path']): string {
    if (path === undefined || path.length === 0) return ''
    let text = ''
    for (let i = 0; i < path.length; i++) {
        const step = path[i] as PropertyKey | { readonly key: PropertyKey }
        const key = typeof step === 'object' ? step.key : step
        text += i === 0 ? String(key) : `.${String(key)}`
    }
    return text
}

/**
 * An `HttpError`, so the status rides on the failure the way every other deliberate one does and
 * `respond` answers with it rather than a 500 — and so the NAME is what crosses the wire, which is
 * what `isError(e, 'AbideSchemaError')` asks about on the other side.
 *
 * The issues are the DATA and the message is built from them, rather than the other way round: a
 * caller putting a refusal beside the field that caused it needs the path, and a sentence it would
 * have to parse to get one is a sentence whose wording is now an interface. Both, because the
 * message is what a log line and an unfamiliar caller read, and neither should have to know the
 * other exists. `data` is what `errorPayload` carries and `wireError` rebuilds, so the array is the
 * same array on either side.
 *
 * The thrown validator is kept as `cause`: it is where a library's own structured issues are, in a
 * shape richer than the two fields that cross, and `isError` looks through a cause already.
 */
function refused(named: Named, what: string, issues: Issue[], status: number, cause?: unknown): HttpError {
    const message = `abide: ${named.address} ${what} does not match its declared shape — ${issueText(issues)}`
    return new HttpError(SCHEMA_ERROR, message, status, { cause, data: issues })
}
