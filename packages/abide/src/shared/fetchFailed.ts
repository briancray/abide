import type { Failed } from './Failed.ts'
import { refuse } from './refuse.ts'

/** 54.9 — what a refused fetch settles to in place of the body. */
export type FetchFailed = Failed<
    'FetchFailed',
    {
        /** The status the service answered at, or `null` where it did not answer. */
        status: number | null
        /** No answer at all, a status outside 2xx, or a body it could not take. */
        reason: 'network' | 'status' | 'shape'
    }
>

const MESSAGES: Record<FetchFailed['data']['reason'], string> = {
    network: 'The service could not be reached.',
    status: 'The service refused the request.',
    shape: 'The service answered with a body this could not read.',
}

export const fetchFailed = refuse.named('FetchFailed', {
    status: 502,
    message: ({ status, reason }: FetchFailed['data']) =>
        reason === 'status'
            ? `The service answered ${status}.`
            : MESSAGES[reason],
    schema: (value) => value as FetchFailed['data'],
})
