import { GET, nonce, trace } from 'abide/server'

/**
 * One unguessable value per request, minted on the first ask.
 *
 * The same value for every asker inside the request — which is the whole point, because the
 * `<script>` and the header that authorises it are written by two different pieces of code and have
 * to agree. A second call in the same request is the same string, exactly as `trace()` is.
 */
export const catalogue = GET(() => ({ nonce: nonce(), operation: trace() }))
