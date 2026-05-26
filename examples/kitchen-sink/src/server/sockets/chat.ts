import { socket } from 'belte/server'

export type ChatMessage = { id: string; from: string; text: string; at: number }

/*
A topic-style broadcast: anyone with the import can publish or
subscribe. `history: 100` retains the last 100 messages and replays
them to new subscribers. `clientPublish` is left off (default false)
so browsers can't publish directly — publish flows through publishChat
which validates input and runs server-side.
*/
export const chat = socket<ChatMessage>({ history: 100 })
