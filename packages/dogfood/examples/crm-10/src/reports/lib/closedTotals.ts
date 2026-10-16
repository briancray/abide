// Thirty days of closed deals, newest last.
const DAILY: { deals: number; revenue: number }[] = []
for (let day = 0; day < 30; day += 1)
    DAILY.push({
        deals: 1 + ((day * 7) % 4),
        revenue: 900 + ((day * 53) % 400),
    })

/** Deals closed and their revenue over the last `days` days. */
export function closedTotals(days: number) {
    let deals = 0
    let revenue = 0
    for (const day of DAILY.slice(-days)) {
        deals += day.deals
        revenue += day.revenue
    }
    return { deals, revenue }
}
