import type { Server } from 'bun'
import { getActiveServer } from './serverSlot.ts'

/*
Returns the active Bun.serve instance. Implemented as a Proxy so the import
reference is stable across modules — consumers can hold `server` at module
scope and still see the real instance after init resolves. Throws on access
before init completes so silent failures surface as loud errors.
*/
export const server = new Proxy({} as Server<unknown>, {
    get(_target, prop, receiver) {
        const active = getActiveServer()
        if (!active) {
            throw new Error(
                '[belte] `server` accessed before init — make sure your call happens inside or after app.ts init() resolves',
            )
        }
        const value = Reflect.get(active, prop, receiver)
        return typeof value === 'function' ? value.bind(active) : value
    },
    has(_target, prop) {
        const active = getActiveServer()
        if (!active) {
            return false
        }
        return Reflect.has(active, prop)
    },
})
