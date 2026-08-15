import { log } from 'abide'

const cart = log.channel('cart')

/**
 * An argument is evaluated before any gate is consulted, so a line interpolating three fields allocates
 * that string per request even with `DEBUG` unset. Asking first is what lets a per-request line stay in
 * the code at all.
 */
export function timed(path: string, started: number): void {
    if (cart.enabled()) cart(`${path} took ${(performance.now() - started).toFixed(1)}ms`)
}
