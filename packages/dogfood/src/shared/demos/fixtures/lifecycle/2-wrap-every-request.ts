import { middleware } from 'abide/server'

/**
 * The chain, outermost first — VARIADIC because the order is the app's to declare rather than the
 * framework's to infer from an import graph.
 *
 * The one registration that APPENDS: a second call adds a second rung rather than correcting the
 * first, which is why it is not spelled `onRequest`. Every other hook is one answer per process.
 */
middleware(async (next) => {
    const answered = await next()
    answered.headers.set('x-served-by', 'the dogfood app')
    return answered
})
