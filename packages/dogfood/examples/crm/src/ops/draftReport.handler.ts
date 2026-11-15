import { POST } from '@abide/abide/server'

type Drafted = { summary: string; description: string }

const DESCRIPTION =
    'Fills in the problem report the person has open: what went wrong, ' +
    'and what they were doing. It sends nothing.'

/** Answers at /ops/draftReport: the assistant's words, for the draft. */
export default POST(
    ({ summary, description }: Drafted): Drafted => ({ summary, description }),
    { description: DESCRIPTION },
)
