// mergeSchemas(routes, schemas) — fold a map of route-name → { input, output } JSON Schema onto the
// live RPC callables (§11).
//
// Merged into `options.schemas` so the registry (OpenAPI/MCP), the router's input validation, and its
// output drift-check + shaping (§5.2) all pick it up with no further wiring. An explicit schema is
// never overwritten, PER FIELD: a handler that hand-wrote `input` still gets a derived `output`.
//
// Two callers reach this with the same map from different places — `loadApp` (baked `dist/schemas.json`
// or a live tsgo pass) and a `abide compile` binary (the baked map, embedded) — so the precedence rule
// lives here once rather than being restated at each boot path.

import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import type { Route } from './router.ts'

export function mergeSchemas(
    routes: Record<string, Route>,
    schemas: Record<string, { input?: JSONSchema; output?: JSONSchema }>,
): void {
    for (const [name, derived] of Object.entries(schemas)) {
        const route = routes[name]
        if (route === undefined) continue
        const options = route.__rpc.options
        const merged = { ...options.schemas }
        if (merged.input === undefined && derived.input !== undefined) merged.input = derived.input
        if (merged.output === undefined && derived.output !== undefined)
            merged.output = derived.output
        options.schemas = merged
    }
}
