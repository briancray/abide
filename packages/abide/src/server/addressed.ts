import { mounted } from '#shared/mount.ts'

/**
 * Gives a handler its address: `route` under the mount, read when it is reported.
 *
 * 16.88 — ONE WRITER, READ LATE: the mount is the configuration's, so the address a file's module
 * is given as it loads is the one a boot would give it, and a later call only names the route again.
 */
export function addressed(handler: object, route: string): void {
    Object.defineProperty(handler, 'address', {
        get: () => mounted(route),
        configurable: true,
    })
}
