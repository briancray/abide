import { config } from 'abide/server'

/**
 * Every knob, typed, from one place — and a field is never absent, because abide's floor fills in
 * whatever nobody declared. `PORT` is a number, not the string that was held.
 */
export function port(): number {
    return config().PORT
}
