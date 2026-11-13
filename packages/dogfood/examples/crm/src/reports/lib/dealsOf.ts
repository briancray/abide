export type ExportedDeal = { company: string; amount: number }

/** `count` deals, each row the same length. */
export function dealsOf(count: number): ExportedDeal[] {
    const deals: ExportedDeal[] = []
    for (let at = 0; at < count; at += 1)
        deals.push({
            company: `Company ${String(at).padStart(4, '0')}`,
            amount: 1000 + (at % 9) * 100,
        })
    return deals
}
