import { GET, redirect } from 'abide/server'

/**
 * An answer that is a place rather than a body. The status is the argument because the difference
 * between them is semantic and easy to get wrong: 302 says "not here NOW", 301 says "never here
 * again" and is cached by every intermediary that sees it.
 */
export const catalogue = GET(({ id }: { id: number }) => redirect(`/items/${id}`, 302))
