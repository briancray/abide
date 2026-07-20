// env(schema) — typed, boot-validated config from the environment (CO1). The environment is
// all-strings; `env` COERCES those strings by the schema (`"3000"` → number, `"true"`/`"false"` →
// boolean, enum members), applies schema DEFAULTS for missing keys, then VALIDATES once. It FAILS
// FAST — throwing a single error naming every missing-required or invalid var — so the process
// never boots half-configured. The result is a frozen typed object.
//
// The schema may be:
//   - a raw JSON Schema object: `{ type: "object", properties: { PORT: { type: "number" } },
//     required: ["PORT"] }` (a field with `default` is treated as not-required),
//   - a plain field-spec map: `{ PORT: { type: "number", default: 3000, required: true } }`,
//   - a Standard Schema (Zod/Valibot/etc.) — coercion is best-effort by the declared JSON-Schema
//     shape when reachable, otherwise the raw values are validated as-is.
//
// TYPING: the supported "typed config" path is SCHEMA-FIRST — write the schema once and the result
// type is INFERRED from it, so there is no `<T>` to keep in sync. A field-spec map
// (`env({ PORT: { type: "number", required: true } })`) infers `{ PORT: number }`; a Standard Schema
// infers its `~standard` output type. This is fully runtime-consistent: the SAME schema drives
// coercion, validation, AND the static type in every environment (`abide build`/`dev`/`run`, tests,
// createTestApp) — a project goal ("consistent runtime between all builds and environments").
//
// `env<T>()` with NO runtime schema stays a best-effort pass-through of the current environment; `T`
// is a compile-time annotation only, NOT runtime-enforced (nothing coerces/validates without a runtime
// schema). Deriving runtime coercion from an ERASED type argument is deliberately NOT done here: it is
// unrepresentable at runtime, and a build-time artifact (`src/.abide/config.schema.json` loaded at
// boot) would make derivation apply under `abide build`/`dev` but silently pass through under `abide
// run`/tests — the exact cross-environment inconsistency the runtime-consistency goal forbids. The
// shared TS7 §11 build-extraction pass (rpc-core §11 / build-pipeline BP1.4) that COULD deliver this
// consistently is a deferred, RPC-first build stage — see docs/spec/config-observability.md CO1.3.

import {
    asStandardSchema,
    type JSONSchema,
    type JSONSchemaType,
    singleType,
} from '../shared/internal/jsonSchema.ts'
import type { StandardSchemaV1 } from '../shared/StandardSchema.ts'

export interface EnvFieldSpec {
    type?: JSONSchemaType
    default?: unknown
    required?: boolean
    enum?: readonly unknown[]
}

export type EnvSchema = StandardSchemaV1 | JSONSchema | Record<string, EnvFieldSpec>

// The environment is all-strings, so an untyped/string field infers as `string`; typed fields map to
// their JS type; an `enum` narrows to the literal union of its members.
type EnvFieldType<F extends EnvFieldSpec> = F extends { enum: infer E extends readonly unknown[] }
    ? E[number]
    : F['type'] extends 'number' | 'integer'
      ? number
      : F['type'] extends 'boolean'
        ? boolean
        : F['type'] extends 'object'
          ? Record<string, unknown>
          : F['type'] extends 'array'
            ? unknown[]
            : F['type'] extends 'null'
              ? null
              : string

// A field is PRESENT in the result when it declares a `default` or is `required: true`; otherwise it
// is optional (absent when the env var is unset) — mirroring the runtime coercion loop below.
type EnvFieldPresent<F extends EnvFieldSpec> = F extends { default: unknown }
    ? true
    : F extends { required: true }
      ? true
      : false

// Infer the typed, frozen config object from a field-spec map, splitting present (required) fields from
// optional ones. `env` takes the schema as `const` so `type`/`required`/`default`/`enum` stay literal.
type InferEnv<S extends Record<string, EnvFieldSpec>> = {
    [K in keyof S as EnvFieldPresent<S[K]> extends true ? K : never]: EnvFieldType<S[K]>
} & {
    [K in keyof S as EnvFieldPresent<S[K]> extends true ? never : K]?: EnvFieldType<S[K]>
}

// One normalised field the coercion loop consumes — monomorphic so the loop stays fast.
interface Field {
    key: string
    type: JSONSchemaType | undefined
    hasDefault: boolean
    defaultValue: unknown
    required: boolean
    enumValues: readonly unknown[] | undefined
}

// No runtime schema → best-effort pass-through (`T` is a compile-time annotation, not enforced).
export function env<T = Record<string, unknown>>(): T
// Standard Schema (Zod/Valibot/ArkType/…) → its inferred output type.
export function env<S extends StandardSchemaV1>(schema: S): StandardSchemaV1.InferOutput<S>
// Field-spec map → typed result inferred from the schema (schema-first; no `<T>` to repeat). Taken as
// `const` so literal `type`/`required`/`default`/`enum` drive the inference.
export function env<const S extends Record<string, EnvFieldSpec>>(schema: S): InferEnv<S>
// Raw JSON Schema object, or an explicit `<T>` — result type is `T` (JSON-Schema → TS inference isn't
// attempted; annotate `<T>` when you want it typed).
export function env<T = Record<string, unknown>>(schema: EnvSchema): T
export function env<T = Record<string, unknown>>(schema?: EnvSchema): T {
    if (schema === undefined) {
        // No runtime schema — best-effort pass-through; type-derivation is build-time (see header).
        return Object.freeze({ ...readAllEnv() }) as T
    }

    const isStandard = typeof schema === 'object' && schema !== null && '~standard' in schema
    const fields = normalizeFields(schema, isStandard)

    const result: Record<string, unknown> = {}
    const missing: string[] = []
    const invalid: string[] = []

    for (const field of fields) {
        const raw = readEnv(field.key)

        if (raw === undefined) {
            if (field.hasDefault) {
                result[field.key] = field.defaultValue
            } else if (field.required) {
                missing.push(field.key)
            }
            continue
        }

        const coerced = coerce(raw, field)
        if (!coerced.ok) {
            invalid.push(`${field.key} (${coerced.message})`)
            continue
        }
        result[field.key] = coerced.value
    }

    if (missing.length > 0 || invalid.length > 0) {
        throw new Error(formatFailure(missing, invalid))
    }

    // Final validation pass against the declared schema, so any constraints the coercion loop does
    // not itself enforce still fail-fast. Env validators must be synchronous to fail-fast at boot;
    // call the Standard-Schema surface directly (a raw JSON Schema is wrapped into the same surface).
    const standard = asStandardSchema(
        isStandard ? (schema as StandardSchemaV1) : (schema as JSONSchema),
    )
    const validation = standard['~standard'].validate(result)
    if (validation instanceof Promise) {
        throw new Error('env(): schema validation must be synchronous.')
    }
    if (validation.issues !== undefined) {
        const details = validation.issues.map((issue) => {
            const path = issue.path
                ?.map((segment) =>
                    typeof segment === 'object' ? String(segment.key) : String(segment),
                )
                .join('.')
            return path !== undefined && path.length > 0
                ? `${path}: ${issue.message}`
                : issue.message
        })
        throw new Error(`env(): invalid environment configuration — ${details.join('; ')}`)
    }

    return Object.freeze(result) as T
}

function normalizeFields(schema: EnvSchema, isStandard: boolean): Field[] {
    if (isStandard) {
        // Best-effort: a Standard Schema exposing a JSON-Schema shape (via toJSONSchema) can still be
        // coerced field-by-field; otherwise there is nothing to derive types from, so the fields list
        // is empty and only the final validation pass runs against the raw values.
        const maybe = schema as { toJSONSchema?: () => JSONSchema }
        if (typeof maybe.toJSONSchema === 'function') {
            return fieldsFromJsonSchema(maybe.toJSONSchema())
        }
        return []
    }

    const jsonSchema = schema as JSONSchema
    if (jsonSchema.type === 'object' || jsonSchema.properties !== undefined) {
        return fieldsFromJsonSchema(jsonSchema)
    }

    // Plain field-spec map: `{ KEY: { type, default, required } }`.
    return fieldsFromSpecMap(schema as Record<string, EnvFieldSpec>)
}

function fieldsFromJsonSchema(schema: JSONSchema): Field[] {
    const properties = schema.properties ?? {}
    const requiredList = schema.required ?? []
    const fields: Field[] = []
    for (const [key, property] of Object.entries(properties)) {
        const hasDefault = 'default' in property
        fields.push({
            key,
            type: singleType(property.type),
            hasDefault,
            defaultValue: property.default,
            // A field with a default is never required (CO1.2).
            required: !hasDefault && requiredList.includes(key),
            enumValues: property.enum,
        })
    }
    return fields
}

function fieldsFromSpecMap(spec: Record<string, EnvFieldSpec>): Field[] {
    const fields: Field[] = []
    for (const [key, field] of Object.entries(spec)) {
        const hasDefault = field.default !== undefined
        fields.push({
            key,
            type: field.type,
            hasDefault,
            defaultValue: field.default,
            required: !hasDefault && field.required === true,
            enumValues: field.enum,
        })
    }
    return fields
}

type Coerced = { ok: true; value: unknown } | { ok: false; message: string }

function coerce(raw: string, field: Field): Coerced {
    let value: unknown = raw
    switch (field.type) {
        case 'number':
        case 'integer': {
            const parsed = Number(raw)
            if (!Number.isFinite(parsed) || raw.trim() === '')
                return { ok: false, message: `expected a ${field.type}, got "${raw}"` }
            if (field.type === 'integer' && !Number.isInteger(parsed))
                return { ok: false, message: `expected an integer, got "${raw}"` }
            value = parsed
            break
        }
        case 'boolean': {
            const lowered = raw.trim().toLowerCase()
            if (lowered === 'true' || lowered === '1') value = true
            else if (lowered === 'false' || lowered === '0') value = false
            else return { ok: false, message: `expected a boolean, got "${raw}"` }
            break
        }
        case 'object':
        case 'array':
        case 'null': {
            try {
                value = JSON.parse(raw)
            } catch {
                return { ok: false, message: `expected JSON ${field.type}, got "${raw}"` }
            }
            break
        }
        default:
            value = raw // string or untyped — leave as-is.
    }

    if (field.enumValues !== undefined && !field.enumValues.includes(value)) {
        return {
            ok: false,
            message: `expected one of ${field.enumValues.map((entry) => JSON.stringify(entry)).join(', ')}, got "${raw}"`,
        }
    }
    return { ok: true, value }
}

function formatFailure(missing: string[], invalid: string[]): string {
    const parts: string[] = []
    if (missing.length > 0)
        parts.push(`missing required environment variable(s): ${missing.join(', ')}`)
    if (invalid.length > 0) parts.push(`invalid environment variable(s): ${invalid.join('; ')}`)
    return `env(): ${parts.join('; ')} — refusing to start.`
}

function readEnv(name: string): string | undefined {
    const bunEnv = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env
    if (bunEnv !== undefined && bunEnv[name] !== undefined) return bunEnv[name]
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
        ?.env?.[name]
}

function readAllEnv(): Record<string, string | undefined> {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    const bunEnv = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun?.env
    return { ...(proc?.env ?? {}), ...(bunEnv ?? {}) }
}
