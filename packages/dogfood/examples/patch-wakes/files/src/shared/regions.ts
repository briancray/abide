export type Region = { id: string; name: string; orders: number }

export type OrderCount = { id: string; orders: number }

// Takes the index and one frame and returns nothing, which is what
// makes it the piece a test can drive without a document.
export function applyOrderCount(
    byId: Map<string, Region>,
    frame: OrderCount,
): void {
    const held = byId.get(frame.id)
    if (held) held.orders = frame.orders
}
