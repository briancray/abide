// The app data this example stands on.

export type Sale = { region: string; orders: number; total: number }

const BY_DAY: Record<string, Sale[]> = {
    '2026-10-07': [
        { region: 'north', orders: 41, total: 12480 },
        { region: 'south', orders: 29, total: 9140 },
        { region: 'east', orders: 22, total: 7020 },
    ],
}

/** One day's sales, read whole — the export is a list before it is a stream. */
export const jsonlExportDatabase = {
    sales: {
        async on(day: string): Promise<Sale[]> {
            await Bun.sleep(400)
            return BY_DAY[day] ?? []
        },
    },
}
