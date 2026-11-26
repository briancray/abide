/** One deal: what it is worth, whose it is, and how far along it is. */
export type Deal = {
    id: string
    name: string
    company: string
    amount: number
    stage: string
}

/** The database, for now: the deals the CRM opens on, and the stage each is in. */
export const DEALS: Deal[] = [
    {
        id: 'd1',
        name: 'Analytical Engines renewal',
        company: 'Analytical Engines',
        stage: 'proposal',
        amount: 42_000,
    },
    {
        id: 'd2',
        name: 'Hopper & Co pilot',
        company: 'Hopper & Co',
        stage: 'lead',
        amount: 8_000,
    },
    {
        id: 'd3',
        name: 'Langley Research seats',
        company: 'Langley Research',
        stage: 'qualified',
        amount: 15_000,
    },
    {
        id: 'd4',
        name: 'Hopper & Co expansion',
        company: 'Hopper & Co',
        stage: 'proposal',
        amount: 23_000,
    },
    {
        id: 'd5',
        name: 'Analytical Engines support',
        company: 'Analytical Engines',
        stage: 'won',
        amount: 12_000,
    },
    {
        id: 'd6',
        name: 'Langley Research audit',
        company: 'Langley Research',
        stage: 'lead',
        amount: 5_000,
    },
    {
        id: 'd7',
        name: 'Hopper & Co training',
        company: 'Hopper & Co',
        stage: 'lead',
        amount: 3_000,
    },
]
