import { identity, memo } from 'abide'

/**
 * Per-caller, by default — which is the only default a server can have: this is declared once at module
 * scope and two requests in flight have two caches, neither able to read the other's.
 */
export const basket = memo(async () => {
    const who = await identity()
    return { owner: who.id, items: [] as string[] }
})
