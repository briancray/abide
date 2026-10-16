/** Five thousand deals, with their value and the days since last contact. */
export const DEALS: { company: string; amount: number; idle: number }[] = []
for (let at = 0; at < 5000; at += 1)
    DEALS.push({
        company: `Company ${at}`,
        amount: (at * 7919) % 50_000,
        idle: (at * 104_729) % 90,
    })

/** The five deals first by `by`, timed as the layer `sort`. */
export function topFive(by: 'amount' | 'idle') {
    performance.mark('sort:start')
    const ranked = [...DEALS].sort((a, b) => b[by] - a[by]).slice(0, 5)
    performance.measure('sort', 'sort:start')
    return ranked
}
