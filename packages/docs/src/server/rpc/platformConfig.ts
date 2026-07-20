// #demo platformConfig
import { env } from 'abide/server/env'
import { GET } from 'abide/server/GET'

// `env(schema)` reads typed, boot-validated config from the environment. Strings are coerced by the
// schema, defaults fill in missing keys, and the result is a frozen typed object. The result type is
// INFERRED from the schema (schema-first) — no `<T>` or `as {…}` to keep in sync: `config.DOCS_MAX_ITEMS`
// is `number`, `config.DOCS_FEATURE_MACHINES` is `boolean`, etc. Here every field has a default so the
// RPC is self-contained (no env vars required to boot).
export default GET(() => {
    const config = env({
        DOCS_APP_NAME: { type: 'string', default: 'abide docs' },
        DOCS_MAX_ITEMS: { type: 'number', default: 25 },
        DOCS_FEATURE_MACHINES: { type: 'boolean', default: true },
    })
    return {
        appName: config.DOCS_APP_NAME,
        maxItems: config.DOCS_MAX_ITEMS,
        featureMachines: config.DOCS_FEATURE_MACHINES,
        maxItemsType: typeof config.DOCS_MAX_ITEMS,
    }
})
// #enddemo
