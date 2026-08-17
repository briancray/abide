import { GET, jsonl } from 'abide/server'

/**
 * A source that throws PART WAY, which is the case the two streaming helpers have and the other five
 * do not: the status line is already out, so there is no refusal left to send.
 *
 * The body is ERRORED instead. A reader sees the stream break rather than a truncated list that looks
 * complete — which is the whole distinction worth making here, because silently short output is the
 * failure mode a consumer cannot detect.
 *
 * The rpc lane's own stream is this same machine with one extra frame, so there it says the failure in
 * a LINE and a caller can read what went wrong. A plain `jsonl` route has nowhere to put that.
 *
 * Written per `pull`, so back-pressure reaches the source: a consumer that stops reading is a generator
 * that stops being asked, rather than a buffer that grows until the process notices.
 */
export const feed = GET(() =>
    jsonl(
        (async function* () {
            yield { at: 1 }
            yield { at: 2 }
            throw new Error('the source gave out')
        })(),
    ),
)
