import { rpc } from '@abide/abide/server'

// What a model writes about the renewal, as it writes it.
const SUMMARY = [
    '### Analytical Engines renewal\n\n',
    'Ada wants the **annual** plan',
    ' at $42,000.\n\n',
    '- legal review by Friday\n',
    '- security questionnaire\n\n',
    '| Stage | Since |\n| --- | --- |\n',
    '| Proposal | Nov 3 |\n\n',
    'Next: send the quote.',
]

/** A deal's summary in markdown, a chunk every 100 ms. */
export default rpc(
    async function* () {
        for (const chunk of SUMMARY) {
            await Bun.sleep(100)
            yield chunk
        }
    },
    { description: 'Summarizes a deal in markdown, as it is written.' },
)
