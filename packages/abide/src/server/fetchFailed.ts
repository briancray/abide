import type { Failed } from '#shared/Failed.ts'
import { refuse } from '#shared/refuse.ts'

/** 54.16 — what a fetch that gave up settles to in place of the body. */
export type FetchFailed = Failed<
    'FetchFailed',
    {
        /** The status the last attempt was answered at, or `null` where none answered. */
        status: number | null
        /** No answer in time, no answer at all, a status it gave up on, or a body it could not take. */
        reason: 'timeout' | 'network' | 'status' | 'shape'
    }
>

const MESSAGES: Record<FetchFailed['data']['reason'], string> = {
    timeout: 'The service did not answer in time.',
    network: 'The service could not be reached.',
    status: 'The service refused the request.',
    shape: 'The service answered with a body this could not read.',
}

export const fetchFailed = refuse.named(
    'FetchFailed',
    502,
    ({ status, reason }: FetchFailed['data']) =>
        reason === 'status'
            ? `The service answered ${status}.`
            : MESSAGES[reason],
    { schema: (value) => value as FetchFailed['data'] },
)
