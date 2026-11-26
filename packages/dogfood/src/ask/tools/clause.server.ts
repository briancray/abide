import { refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

import { CLAUSE_TEXTS } from '#src/rulebook/lib/CLAUSE_TEXTS.server.ts'

export default rpc(
    ({ number }: { number: string }) => {
        const text = CLAUSE_TEXTS.get(number)
        if (text === undefined)
            throw refuse.notFound({ path: number, method: 'GET' })
        return { number, text }
    },
    {
        description:
            'One numbered clause of the abide rulebook, e.g. 12.3: the rule a behavior is held to.',
    },
)
