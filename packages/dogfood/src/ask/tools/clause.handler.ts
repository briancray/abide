import { GET, refuse } from '@abide/abide/server'

import { rulebookClauses } from '#src/rulebook/lib/rulebookClauses.ts'

import RULEBOOK from '../../../../../docs/RULEBOOK.md' with { type: 'text' }

const CLAUSES = new Map<string, string>()
for (const clause of rulebookClauses(RULEBOOK))
    CLAUSES.set(clause.id, clause.text)

export default GET(
    ({ number }: { number: string }) => {
        const text = CLAUSES.get(number)
        if (text === undefined)
            throw refuse.notFound({ path: number, method: 'GET' })
        return { number, text }
    },
    {
        description:
            'One numbered clause of the abide rulebook, e.g. 12.3: the rule a behavior is held to.',
    },
)
