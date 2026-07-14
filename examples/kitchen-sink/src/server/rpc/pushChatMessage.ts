import { error } from '@abide/abide/server/error'
import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { amend } from '@abide/abide/shared/amend'
import { z } from 'zod'
import type { ChatMessage } from '$server/sockets/chat.ts'
import { chatState, recordChat } from '../../chatState.ts'
import { getChatLog } from './getChatLog.ts'

const inputSchema = z.object({ from: z.string(), text: z.string() })

/*
Server-driven amend broadcast (ADR-0043): the sibling of the socket + watch(chat, …)
flow in /reactive-state/reactions, one hop shorter. Record the message, then call
amend(getChatLog, value) on the SERVER — which pushes the new cached value of getChatLog
to every client reading that call, with no socket, no client-side watch, and zero
refetch. From the server, amend must pass a concrete value: an updater is a closure with
no wire form and throws. The value form is keyed by the exact call, so only clients that
are actually reading getChatLog (and therefore already authorized for it) receive it.
*/
export const pushChatMessage = POST(
    ({ from, text }) => {
        const trimmedFrom = from.trim()
        const trimmedText = text.trim()
        if (!trimmedFrom || !trimmedText) {
            return error(400, 'from and text are required')
        }
        const message: ChatMessage = {
            id: crypto.randomUUID(),
            from: trimmedFrom,
            text: trimmedText,
            at: Date.now(),
        }
        recordChat(message)
        /* Push the whole new list value to every client reading getChatLog — the browser sets
           it locally, no refetch. Two-arg value form; getChatLog is a no-input rpc, so no key. */
        amend(getChatLog, { messages: chatState.recent })
        return json(message)
    },
    { schemas: { input: inputSchema } },
)
