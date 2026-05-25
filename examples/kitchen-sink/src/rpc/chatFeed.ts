import { SOCKET } from 'belte/rpc'
import { watchChat, type ChatMessage } from '../chatState.ts'

/*
SOCKET rpc — multiplexed onto the framework-owned websocket at
/__belte/socket. The handler is an async generator; consumers iterate it
the same way regardless of transport (`subscribe(chatFeed)()` on the
client, `for await (... of chatFeed.stream())` server-side).

When a client unsubscribes (or its ws drops), the framework calls
`.return()` on the iterator, so the `finally` inside watchChat() fires
and the subscriber set is cleaned up.
*/
export const chatFeed = SOCKET<undefined, ChatMessage>(async function* () {
    for await (const message of watchChat()) {
        yield message
    }
})
