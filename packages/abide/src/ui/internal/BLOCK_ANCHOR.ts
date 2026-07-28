// The comment-anchor VALUES that bracket a block/component region: `<!--[-->` … `<!--]-->`. Unlike
// `HTML_ANCHOR` the pair carries no escalating suffix — a block's extent is found by DEPTH COUNTING
// (`runtime.findBlockClose`), since a nested block emits the same two markers and the nesting is known
// from the plan rather than from the markup.
//
// This is the whole server/client hydration handshake in two characters, and it was previously three
// separate copies: raw `'<!--[--><!--]-->'` literals in the client skeleton (`templatePlan`), raw
// `'<!--[-->'`/`'<!--]-->'` string concatenation in the server emitter (`emitServer.genChunk`), and
// private `BLOCK_OPEN`/`BLOCK_CLOSE` consts in the claim walk (`runtime`). Nothing tied them together
// but a comment claiming "anchors match the client by construction". Changing one and not the others
// is not a crash — the claim walk simply fails to recognise the server node, falls back to a fresh
// mount, and the page silently loses its SSR paint. Read the markers from here so that cannot happen.
export const BLOCK_ANCHOR = { open: '[', close: ']' } as const
