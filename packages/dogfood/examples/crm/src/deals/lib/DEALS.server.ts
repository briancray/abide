/** One deal: what it is worth, and how far along it is. */
export type Deal = {
    id: string
    name: string
    company: string
    amount: number
    stage: string
}

/** The database, for now: the deals the CRM opens on. */
export const DEALS: Deal[] = [
    {
        id: 'd1',
        name: 'Engine renewal',
        company: 'Analytical Engines',
        amount: 12000,
        stage: 'proposal',
    },
    {
        id: 'd2',
        name: 'Compiler pilot',
        company: 'Hopper & Co',
        amount: 4800,
        stage: 'qualified',
    },
    {
        id: 'd3',
        name: 'Trajectory seats',
        company: 'Langley Research',
        amount: 22500,
        stage: 'won',
    },
]
