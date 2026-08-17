import { GET, redirect } from 'abide/server'

/**
 * An answer that is a place rather than a body. The status is the argument because the difference
 * between them is semantic and easy to get wrong: 302 says "not here NOW", 301 says "never here
 * again" and is cached by every intermediary that sees it.
 *
 * `/users/[id]` is a real page of this app, so the browser half beside this can follow the hop and
 * report where it landed — which is the only part of a redirect a browser is allowed to see.
 */
export const catalogue = GET(({ id }: { id: number }) => redirect(`/users/${id}`, 302))
