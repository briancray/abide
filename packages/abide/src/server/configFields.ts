// 38.72 — THE FIELDS THE DESKTOP LAUNCHER'S START FORM ASKS FOR: the members of the `onConfig`
// schema's JSON Schema, probed as 20.11 probes a handler's, and the fields `onConfig`'s defaults
// return where the schema has no document to read.

import { HOOKS, inOrder } from './hooks.ts'

type Property = {
    type?: string | string[]
    title?: string
    description?: string
    default?: unknown
    enum?: unknown[]
    format?: string
    writeOnly?: boolean
}

/** One input on the start form. */
export type ConfigField = {
    name: string
    label: string
    description: string | undefined
    input: 'text' | 'number' | 'checkbox' | 'password' | 'url' | 'select'
    options: string[] | undefined
    required: boolean
    /** What the form shows before anything is typed: the environment's, then the default's. */
    value: string
}

/** The start form's fields, under `env` — each prefilled from it, or from its default. */
export function configFields(
    env: Record<string, string | undefined>,
): ConfigField[] {
    // 27.6, 37.7 — EVERY `onConfig`, its defaults and its schema's fields merged in route order.
    const defaults: Record<string, unknown> = {}
    let declared: Record<string, Property> | undefined
    const required = new Set<string>()
    for (const { defaults: given, options } of inOrder(HOOKS.config)) {
        try {
            const answered = given?.({ ...env })
            if (answered !== null && typeof answered === 'object')
                Object.assign(defaults, answered)
        } catch {}
        const schema = options?.schema as
            | {
                  '~standard'?: {
                      jsonSchema?: { input?: (options: unknown) => unknown }
                  }
              }
            | undefined
        let document:
            | { properties?: Record<string, Property>; required?: string[] }
            | undefined
        try {
            document = schema?.['~standard']?.jsonSchema?.input?.({
                target: 'draft-2020-12',
            }) as typeof document
        } catch {}
        if (document?.properties !== undefined)
            declared = { ...declared, ...document.properties }
        for (const name of document?.required ?? []) required.add(name)
    }
    const properties: Record<string, Property> =
        declared ??
        Object.fromEntries(Object.keys(defaults).map((name) => [name, {}]))
    const fields: ConfigField[] = []
    for (const [name, property] of Object.entries(properties)) {
        const fallback = defaults[name] ?? property.default
        const type = Array.isArray(property.type)
            ? property.type[0]
            : property.type
        const input: ConfigField['input'] =
            property.enum !== undefined
                ? 'select'
                : type === 'boolean' || typeof fallback === 'boolean'
                  ? 'checkbox'
                  : type === 'number' ||
                      type === 'integer' ||
                      typeof fallback === 'number'
                    ? 'number'
                    : property.format === 'password' ||
                        property.writeOnly === true
                      ? 'password'
                      : property.format === 'uri' || property.format === 'url'
                        ? 'url'
                        : 'text'
        fields.push({
            name,
            label: property.title ?? name,
            description: property.description,
            input,
            options: property.enum?.map(String),
            required: required.has(name),
            value:
                env[name] ?? (fallback === undefined ? '' : String(fallback)),
        })
    }
    return fields
}
