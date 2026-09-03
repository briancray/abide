import { channel } from 'abide'

export type Order = {
    id: number
    customer: string
    status: 'placed' | 'picking' | 'shipped'
    total: number
}

// What one frame carries: the whole row as it now stands, or `null`
// where the order is gone. A tombstone rather than an absent field,
// since JSON drops `undefined` and a dropped field reads as "no
// change" at the other end.
export type OrderChange = { id: number; order: Order | null }

// Every warehouse event lands here. One room, because the page wants
// every order's changes rather than one order's.
export const orderChanged = channel<OrderChange>()

// The fold, kept OUT of the page so it is the thing tests exercise:
// one frame applied to the index in place, which is the O(1) that
// `patch` exists to make visible.
export function applyOrderChange(
    byId: Map<number, Order>,
    { id, order }: OrderChange,
): void {
    if (order === null) {
        byId.delete(id)
        return
    }
    byId.set(id, order)
}

// Stands in for the read this page is not about — a `GET` handler
// once you have read "Data from the server".
export async function loadOrders(): Promise<Order[]> {
    return [
        { id: 4021, customer: 'Ada Bell', status: 'shipped', total: 82.4 },
        { id: 4022, customer: 'Bo Ryan', status: 'picking', total: 15.0 },
        { id: 4023, customer: 'Cy Okon', status: 'placed', total: 240.75 },
        { id: 4024, customer: 'Di Marsh', status: 'placed', total: 61.2 },
    ]
}
