export type Region = { id: string; name: string; orders: number }

export type OrderCount = { id: string; orders: number }

// Returns nothing, so a test can drive it without a document.
export function applyOrderCount(
    byId: Map<string, Region>,
    frame: OrderCount,
): void {
    const held = byId.get(frame.id)
    if (held) held.orders = frame.orders
}
