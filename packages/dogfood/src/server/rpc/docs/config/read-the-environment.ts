import { config, GET } from 'abide/server'

/**
 * Every knob, typed, from one place — and a field is never absent, because abide's floor fills in
 * whatever nobody declared. `PORT` is a number, not the string that was held.
 */
export const environment = GET(() => ({
    port: config().PORT,
    logs: config().ABIDE_LOGS,
    production: config().NODE_ENV === 'production',
}))

/**
 * The rung ABOVE this one, read back: `DOCS_GREETING` is on no floor abide ships and in nobody's
 * environment, so what answers here is the app's own layer and nothing else.
 *
 * A second export rather than a second module, because the two are one question asked twice — what
 * does `config()` say, and where did that answer come from.
 */
export const ourOwnDefault = GET(() => ({
    greeting: String(config().DOCS_GREETING),
    // Declared by abide, so it is the floor answering rather than the app.
    logs: config().ABIDE_LOGS,
}))
