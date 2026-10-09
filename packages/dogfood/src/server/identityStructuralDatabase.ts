// The app data this example stands on: two regional totals, read back as a fresh record on every
// load the way a query result is.

export type Sales = { north: number; south: number }

const totals: Sales = { north: 1240, south: 980 }

export const identityStructuralDatabase = {
    sales: {
        async read(): Promise<Sales> {
            await Bun.sleep(150)
            return { ...totals }
        },
        async record(region: keyof Sales): Promise<void> {
            totals[region] += 120
        },
    },
}
