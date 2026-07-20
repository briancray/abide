// Runtime JSON Schema validator (draft 2020-12 SUBSET) — M8b. abide emits a constrained slice of
// JSON Schema from its type-derived and hand-written schemas; this validates a value against that
// slice with no dependencies. Anything outside the supported keyword set is treated permissively
// (an unknown keyword neither passes nor fails on its own), so a partially-understood schema still
// validates the parts it understands rather than rejecting everything.
//
// Issues are shaped like Standard Schema issues (`message` + `path` array) so they flow straight
// into ValidationErrorData via the Standard Schema path (see toStandard below).

import type { StandardSchemaV1 } from '../StandardSchema.ts'

// The supported draft-2020-12 subset. Every field is optional because abide composes these freely;
// a schema may be nothing but `{ type: "string" }` or a bare `{ anyOf: [...] }`.
export interface JSONSchema {
    type?: JSONSchemaType | JSONSchemaType[]
    properties?: Record<string, JSONSchema>
    required?: string[]
    additionalProperties?: boolean | JSONSchema
    items?: JSONSchema
    enum?: unknown[]
    const?: unknown
    anyOf?: JSONSchema[]
    oneOf?: JSONSchema[]
    allOf?: JSONSchema[]
    nullable?: boolean
    format?: string
    minimum?: number
    maximum?: number
    minLength?: number
    maxLength?: number
    pattern?: string
    // Unknown keywords are tolerated but ignored.
    [keyword: string]: unknown
}

export type JSONSchemaType =
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null'

// The non-null member of a `type` union (e.g. `["string","null"]` → "string"); a scalar type passes
// through. Used by the string→typed coercers (env config, multipart form-text projection).
export function singleType(
    type: JSONSchemaType | JSONSchemaType[] | undefined,
): JSONSchemaType | undefined {
    if (Array.isArray(type)) return type.find((candidate) => candidate !== 'null')
    return type
}

type Issue = { message: string; path: Array<string | number> }

export type ValidateJsonSchemaResult = { ok: true } | { ok: false; issues: Issue[] }

// Validate `value` against `schema`, collecting every issue with its JSON path. `ok: true` means
// no issues were found.
export function validateJsonSchema(schema: JSONSchema, value: unknown): ValidateJsonSchemaResult {
    const issues: Issue[] = []
    validateNode(schema, value, [], issues)
    return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

// Wrap a JSON Schema as a Standard Schema so the RPC path can treat JSON Schema and native Standard
// Schema uniformly — one validation surface, one issue shape.
export function toStandard(jsonSchema: JSONSchema): StandardSchemaV1 {
    return {
        '~standard': {
            version: 1,
            vendor: 'abide',
            validate(value: unknown): StandardSchemaV1.Result<unknown> {
                const result = validateJsonSchema(jsonSchema, value)
                if (result.ok) return { value }
                return { issues: result.issues }
            },
        },
    }
}

// Normalise an RPC schema to a Standard Schema. A native Standard Schema (Zod/Valibot/etc.) carries
// `~standard` and passes through untouched; anything else is treated as a raw/derived JSON Schema and
// wrapped with `toStandard`, so `schemas.input`/`schemas.output` accept either kind uniformly.
export function asStandardSchema(schema: StandardSchemaV1 | JSONSchema): StandardSchemaV1 {
    if (typeof schema === 'object' && schema !== null && '~standard' in schema) {
        return schema as StandardSchemaV1
    }
    return toStandard(schema as JSONSchema)
}

function validateNode(
    schema: JSONSchema,
    value: unknown,
    path: Array<string | number>,
    issues: Issue[],
): void {
    // const — strict deep-ish equality against a single allowed value.
    if ('const' in schema) {
        if (!deepEqual(value, schema.const)) {
            issues.push({ message: `Expected constant ${stringify(schema.const)}`, path })
        }
    }

    // enum — value must be one of the listed members.
    if (schema.enum !== undefined) {
        let matched = false
        for (const candidate of schema.enum) {
            if (deepEqual(value, candidate)) {
                matched = true
                break
            }
        }
        if (!matched) {
            issues.push({
                message: `Expected one of ${schema.enum.map(stringify).join(', ')}`,
                path,
            })
        }
    }

    // nullable — draft-independent shorthand abide may emit; null short-circuits the rest, including
    // the type check (nullable pairs with a non-null `type`).
    if (schema.nullable === true && value === null) {
        validateCombinators(schema, value, path, issues)
        return
    }

    // type — a single type or a union of types (the union form carries nullability).
    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type]
        let matched = false
        for (const type of types) {
            if (matchesType(type, value)) {
                matched = true
                break
            }
        }
        if (!matched) {
            issues.push({ message: `Expected type ${types.join(' or ')}`, path })
            // No point validating shape/format against a value of the wrong type.
            validateCombinators(schema, value, path, issues)
            return
        }
    }

    // Object shape.
    if (isPlainObject(value)) {
        validateObject(schema, value, path, issues)
    }

    // Array items.
    if (Array.isArray(value) && schema.items !== undefined) {
        for (let index = 0; index < value.length; index++) {
            validateNode(schema.items, value[index], [...path, index], issues)
        }
    }

    // String constraints + format.
    if (typeof value === 'string') {
        validateString(schema, value, path, issues)
    }

    // Numeric bounds.
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            issues.push({ message: `Expected >= ${schema.minimum}`, path })
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            issues.push({ message: `Expected <= ${schema.maximum}`, path })
        }
    }

    validateCombinators(schema, value, path, issues)
}

function validateObject(
    schema: JSONSchema,
    value: Record<string, unknown>,
    path: Array<string | number>,
    issues: Issue[],
): void {
    if (schema.required !== undefined) {
        for (const key of schema.required) {
            if (!(key in value)) {
                issues.push({ message: `Missing required property "${key}"`, path: [...path, key] })
            }
        }
    }

    if (schema.properties !== undefined) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            if (key in value) {
                validateNode(propSchema, value[key], [...path, key], issues)
            }
        }
    }

    if (schema.additionalProperties !== undefined) {
        const declared = schema.properties
        for (const key in value) {
            if (declared !== undefined && key in declared) continue
            if (schema.additionalProperties === false) {
                issues.push({ message: `Unexpected property "${key}"`, path: [...path, key] })
            } else if (typeof schema.additionalProperties === 'object') {
                validateNode(schema.additionalProperties, value[key], [...path, key], issues)
            }
        }
    }
}

function validateString(
    schema: JSONSchema,
    value: string,
    path: Array<string | number>,
    issues: Issue[],
): void {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
        issues.push({ message: `Expected length >= ${schema.minLength}`, path })
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        issues.push({ message: `Expected length <= ${schema.maxLength}`, path })
    }
    if (schema.pattern !== undefined) {
        // Best-effort: an unparsable pattern is skipped rather than treated as a failure.
        let regex: RegExp | undefined
        try {
            regex = new RegExp(schema.pattern)
        } catch {
            regex = undefined
        }
        if (regex !== undefined && !regex.test(value)) {
            issues.push({ message: `Expected string matching /${schema.pattern}/`, path })
        }
    }
    if (schema.format === 'date-time' && !isIsoDateTime(value)) {
        issues.push({ message: 'Expected an ISO 8601 date-time string', path })
    }
}

// anyOf / oneOf / allOf. Combinator failures are reported at the current node with a summarising
// message rather than surfacing every branch's issues, which would be noise.
function validateCombinators(
    schema: JSONSchema,
    value: unknown,
    path: Array<string | number>,
    issues: Issue[],
): void {
    if (schema.anyOf !== undefined) {
        let passed = false
        for (const branch of schema.anyOf) {
            if (validateJsonSchema(branch, value).ok) {
                passed = true
                break
            }
        }
        if (!passed) issues.push({ message: 'Did not match any of the allowed schemas', path })
    }

    if (schema.oneOf !== undefined) {
        let matches = 0
        for (const branch of schema.oneOf) {
            if (validateJsonSchema(branch, value).ok) matches++
        }
        if (matches !== 1)
            issues.push({
                message: `Expected to match exactly one schema, matched ${matches}`,
                path,
            })
    }

    if (schema.allOf !== undefined) {
        for (const branch of schema.allOf) {
            validateNode(branch, value, path, issues)
        }
    }
}

function matchesType(type: JSONSchemaType, value: unknown): boolean {
    switch (type) {
        case 'string':
            return typeof value === 'string'
        case 'number':
            return typeof value === 'number' && Number.isFinite(value)
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value)
        case 'boolean':
            return typeof value === 'boolean'
        case 'object':
            return isPlainObject(value)
        case 'array':
            return Array.isArray(value)
        case 'null':
            return value === null
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Accept the common ISO 8601 date-time shapes JSON Schema `date-time` describes: a date, a `T` (or
// space) separator, a time, and an optional zone offset. Requires Date to parse it too.
function isIsoDateTime(value: string): boolean {
    const shape = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/
    if (!shape.test(value)) return false
    return !Number.isNaN(Date.parse(value))
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (a === null || b === null) return a === b
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false
        }
        return true
    }
    if (typeof a === 'object' && typeof b === 'object') {
        const ao = a as Record<string, unknown>
        const bo = b as Record<string, unknown>
        const aKeys = Object.keys(ao)
        const bKeys = Object.keys(bo)
        if (aKeys.length !== bKeys.length) return false
        for (const key of aKeys) {
            if (!(key in bo) || !deepEqual(ao[key], bo[key])) return false
        }
        return true
    }
    return false
}

function stringify(value: unknown): string {
    if (typeof value === 'string') return JSON.stringify(value)
    return String(value)
}
