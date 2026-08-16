import { GET, redirect } from 'abide/server'

/**
 * The third argument, and the reason `redirect` has one at all: a sign-in answers with a LOCATION and
 * a `Set-Cookie` at the same time, and those are not two responses.
 *
 * Every helper takes a `ResponseInit` for the same reason — it is where the caller's own headers ride.
 * The status stays its own argument rather than living in here, because it is the thing most easily
 * got wrong and it should be visible at the call rather than buried in an object.
 *
 * The set is CLOSED: `301`, `302`, `303`, `307`, `308`, and `302` when nothing is said. A redirect with
 * a status that is not one of those is not a redirect, so it is a type error rather than a header a
 * browser quietly ignores.
 */
export const signedIn = GET(() =>
    redirect('/dashboard', 303, {
        headers: { 'set-cookie': 'session=abc; HttpOnly; Path=/; SameSite=Lax' },
    }),
)
