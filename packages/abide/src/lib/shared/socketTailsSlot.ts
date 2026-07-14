import { createResolverSlot } from './createResolverSlot.ts'
import type { SocketTails } from './types/SocketTails.ts'

/*
The active socket-tail slot — mirrors `resolvedCellsSlot`, but deliberately WITHOUT a lazily-created
shared fallback. `defineSocket`'s server `peek()` records into it on every retained-frame read, and a
socket peeked outside a request (a ws message handler, boot, cron) has no request store — a shared
fallback would then accumulate entries no page render ever drains, a slow leak. With no fallback,
`get()` returns undefined off-request and the record is skipped. During an SSR render the server
entry's resolver returns the request store's list, which `createUiPageRenderer` drains into
`__SSR__.sockets`.
*/
export const socketTailsSlot = createResolverSlot<SocketTails>()
