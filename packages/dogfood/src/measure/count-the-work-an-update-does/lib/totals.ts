// Thirty days of the dashboard's traffic, newest last.
const DAILY: { visitors: number; signups: number; revenue: number }[] = []
for (let day = 0; day < 30; day += 1)
    DAILY.push({
        visitors: 400 + ((day * 37) % 90),
        signups: 12 + ((day * 7) % 9),
        revenue: 900 + ((day * 53) % 400),
    })

/** The last `days` days, summed. */
export function totals(days: number) {
    const total = { visitors: 0, signups: 0, revenue: 0 }
    for (const day of DAILY.slice(-days)) {
        total.visitors += day.visitors
        total.signups += day.signups
        total.revenue += day.revenue
    }
    return total
}
