/**
 * The key of the message the router posts the offline worker, naming the address a navigation
 * reached, which the worker then keeps (45.24).
 *
 * A leaf, because the server writes it into the worker's script and the router posts it.
 */
export const REACHED_MESSAGE = 'reached'
