// Text only: a rung here IS a Response, and a page cannot mount one.
import type { Example } from 'harness'
import ONE from './1-answer-with-json.ts?source'
import TWO from './2-answer-with-a-page.ts?source'
import THREE from './3-answer-with-a-location.ts?source'
import FOUR from './4-refuse-with-a-status.ts?source'
import FIVE from './5-answer-with-many.ts?source'
import SIX from './6-answer-with-events.ts?source'

export const LADDER: Example[] = [
    { adds: 'answer with JSON, when the route builds its own Response', of: ['json'], source: ONE },
    { adds: 'answer with HTML — and a streamed body is HELD past the handler', of: ['page'], source: TWO },
    { adds: 'answer with a location instead of a body', of: ['redirect'], source: THREE },
    // Two names, one idea: `error` is the throw and `HttpError` is what it throws, so a rung showing
    // one without the other would be showing half a mechanism.
    {
        adds: 'refuse with a status, THROWN so it can come from anywhere under the handler',
        of: ['error', 'HttpError'],
        source: FOUR,
    },
    { adds: 'answer with many, one line each, as they arrive', of: ['jsonl'], source: FIVE },
    { adds: 'frame that same source as events, for an EventSource to read', of: ['sse'], source: SIX },
]
