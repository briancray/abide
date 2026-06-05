import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'

/*
Holds the schema handed to env() so the bundle launcher can project the
first-run setup form from it (jsonSchemaForSchema) without re-running boot
validation. `skipValidation` lets the launcher import src/server/config.ts
purely to register the schema: env() records it and returns early instead of
validating Bun.env — which the launcher has no business doing, that's the
embedded server's job at its own boot. In-process module state, so the server
child the launcher spawns gets a fresh store and validates normally.
*/
export const envSchemaStore: {
    schema: StandardSchemaV1 | undefined
    skipValidation: boolean
} = { schema: undefined, skipValidation: false }
