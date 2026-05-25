/*
Tiny in-memory chat log + fan-out. publishChat (POST rpc) calls
appendChat() to record + broadcast; chatFeed (SOCKET rpc) iterates
watchChat() to get the existing log followed by live messages.

Each watchChat() iterator keeps its own queue + notifier. When the
ws disconnects, the framework calls `.return()` on the iterator,
the `finally` block unregisters the subscriber, and any held
notifier is dropped — no leaks.
*/
export type ChatMessage = { id: string; from: string; text: string; at: number }

export const chatLog: ChatMessage[] = []

const subscribers = new Set<(message: ChatMessage) => void>()

export function appendChat(message: ChatMessage): void {
    chatLog.push(message)
    if (chatLog.length > 100) {
        chatLog.shift()
    }
    for (const subscriber of subscribers) {
        subscriber(message)
    }
}

export async function* watchChat(): AsyncGenerator<ChatMessage, void, undefined> {
    const queue: ChatMessage[] = [...chatLog]
    let notify: (() => void) | undefined
    const subscriber = (message: ChatMessage) => {
        queue.push(message)
        notify?.()
        notify = undefined
    }
    subscribers.add(subscriber)
    try {
        while (true) {
            while (queue.length === 0) {
                await new Promise<void>((resolve) => {
                    notify = resolve
                })
            }
            yield queue.shift() as ChatMessage
        }
    } finally {
        subscribers.delete(subscriber)
    }
}
