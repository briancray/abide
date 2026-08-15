import { navigate, route } from 'abide'

/**
 * A navigation is a real request the app's own middleware sees — which is why auth on a page is
 * middleware rather than a check a client could skip.
 */
export async function goToUser(id: string): Promise<void> {
    await navigate(`/users/${id}`)
}

/**
 * `route()` is a REACTIVE ambient, so a same-route move republishes rather than remounting: a reader of
 * `params` wakes and a reader of `name` stays asleep.
 */
export function stillOnAUserPage(): boolean {
    return route().name === '/users/[id]'
}
