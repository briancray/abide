import type { Middleware } from 'abide/server'

/**
 * The chain, outermost first — an ARRAY because the order is the app's to declare rather than the
 * framework's to infer from an import graph.
 */
export const middleware: Middleware[] = [
    async (next) => {
        const answered = await next()
        answered.headers.set('x-served-by', 'the dogfood app')
        return answered
    },
]
