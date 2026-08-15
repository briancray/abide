import { log } from 'abide'

/**
 * Prefixed with the app's own name: on an app called `shop` this is `shop:cart`, which is what
 * `DEBUG=shop:cart` — or `DEBUG=shop:*` — turns on. Silent otherwise.
 */
const cart = log.channel('cart')

export function added(sku: string, quantity: number): void {
    cart(`added ${sku} x${quantity}`)
}
