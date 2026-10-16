import { GET } from '@abide/abide/server'

const BALANCES: Record<string, string> = {
    'A-1042': '$2,140.00',
    'A-1043': '$0.00',
}

export default GET(
    ({ account }: { account: string }) => ({
        account,
        balance: BALANCES[account] ?? 'no such account',
    }),
    { description: 'What an account owes, by account number.' },
)
