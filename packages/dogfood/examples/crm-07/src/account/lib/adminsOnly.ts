import { type Middleware, principal, refuse } from '@abide/abide'

// One rung for a handler's `middleware` and a layout's alike.
export const adminsOnly: Middleware = async (next) => {
    const { role } = await principal.resolved
    return role === 'admin' ? next() : refuse(403, 'Admins only.')
}
