// cliCommands(config) — the THIRD projection of the one registry (machine-surfaces.md MS1/MS3.2):
// each `clients.cli` RPC becomes a subcommand, and its input schema's fields become that subcommand's
// flags. Sibling of `mcpTools` (MS2) and the OpenAPI document (MS4) — same source, different shape.
//
// The projection is deliberately shallow: a flag is a TOP-LEVEL field of the args object, typed by the
// schema so `--n 5` arrives as the number 5. A nested object or array field keeps its JSON spelling
// (`--tags '["a","b"]'`), because inventing a flag dialect for nested shapes would be a second, worse
// encoding of a thing JSON already spells — and `--args '<json>'` covers the whole object at once.
//
// A type-derived read carries no runtime schema unless `abide build` baked one, so `fields` may be
// empty. That is not an error: the command still runs, its flags just pass through as strings (with a
// JSON-ish coercion) and the server's own validation is the arbiter, exactly as it is for a curl.

import type { JSONSchema, JSONSchemaType } from '../../shared/internal/jsonSchema.ts'
import { singleType } from '../../shared/internal/jsonSchema.ts'
import { log } from '../../shared/log.ts'
import { buildRegistry } from '../internal/registry.ts'
import type { AppConfig } from '../internal/router.ts'
import { rpcsFor } from '../internal/surfaceProjection.ts'
import { RESERVED_CLI_COMMANDS } from './RESERVED_CLI_COMMANDS.ts'

export interface CliCommandField {
    name: string
    // The declared scalar/composite type, or undefined when the schema does not say.
    type: JSONSchemaType | undefined
    required: boolean
    description?: string
    enum?: unknown[]
    // What the handler uses when the flag is omitted — a schema `default`, which for a type-derived
    // handler is its destructuring default (`({ message = 'hello' })`). Absent when none is declared;
    // `undefined` needs no separate flag because JSON Schema cannot express it as a value.
    default?: unknown
}

export interface CliCommand {
    name: string
    method: string
    read: boolean
    doc?: string
    // Whether the input schema enumerated fields at all. `false` means "flags are unknown here" — the
    // parser then accepts any flag rather than rejecting the ones it cannot see.
    schemaKnown: boolean
    fields: CliCommandField[]
}

function fieldsOf(schema: JSONSchema | undefined): CliCommandField[] {
    const properties = schema?.properties
    if (properties === undefined) return []
    const required = new Set(schema?.required ?? [])
    const fields: CliCommandField[] = []
    for (const [name, property] of Object.entries(properties)) {
        const field: CliCommandField = {
            name,
            type: singleType(property.type),
            required: required.has(name),
        }
        if (property.default !== undefined) field.default = property.default
        if (typeof property.description === 'string') field.description = property.description
        if (Array.isArray(property.enum)) field.enum = property.enum
        fields.push(field)
    }
    return fields
}

export function cliCommands(config: AppConfig): CliCommand[] {
    const commands: CliCommand[] = []
    for (const rpc of rpcsFor(buildRegistry(config), 'cli')) {
        const command: CliCommand = {
            name: rpc.name,
            method: rpc.method,
            read: rpc.read,
            schemaKnown: rpc.inputSchema?.properties !== undefined,
            fields: fieldsOf(rpc.inputSchema),
        }
        if (rpc.doc !== undefined) command.doc = rpc.doc
        // A shadowed rpc is still projected (it shows in help, and the REPL can describe it) — it just
        // cannot be REACHED by that name, so say so rather than leaving the author to discover it. A
        // prompt-only name (`exit`/`quit`) shadows LESS: the rpc still runs as `app exit`.
        if (Object.hasOwn(RESERVED_CLI_COMMANDS, rpc.name)) {
            const reserved = RESERVED_CLI_COMMANDS[rpc.name as keyof typeof RESERVED_CLI_COMMANDS]
            const reach =
                reserved.where === 'prompt'
                    ? 'cannot be called from the interactive prompt (it is still callable as a subcommand)'
                    : 'cannot be called from the command line'
            log.channel('abide:cli').warn(
                `rpc "${rpc.name}" is shadowed by the built-in \`${rpc.name}\` command and ${reach}. Rename it, or set clients.cli: false to drop it from this surface.`,
            )
        }
        commands.push(command)
    }
    commands.sort((a, b) => (a.name < b.name ? -1 : 1))
    return commands
}
