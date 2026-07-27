import { channel } from 'abide/shared/channel'

// A channel consumed by PLAIN SERVER CODE — no template, no transport, no `{#for await}`. A `Channel<T>`
// IS an `AsyncIterable<T>`, so `for await (const message of chatter)` is the entire subscription API:
// iterate to subscribe, leave the loop to unsubscribe. This module is what the /channel server-loop card
// demonstrates; the two RPCs beside it only publish into the channel and read back what the loop kept.
//
// The loop runs in an async IIFE rather than at top level on purpose: a top-level `for await` over a live
// topic never returns, so it would hang this module's evaluation forever and the app would never boot.
//
// Module-level, so PROCESS-GLOBAL — one loop and one transcript across all requests. It starts at import
// time, which is NOT inside a page render, so `reactiveScope().rendering` is false and the iteration is a
// real live subscription. (Iterated inside an SSR render the same channel yields its `tail` snapshot and
// completes instead, so a render can't hang on it.)

// #demo chatterLoop
const chatter = channel<string>()

// What the loop has received. Capped — a live subscription runs for the life of the process.
const seen: string[] = []
let running = false

function watchChatter(): void {
    if (running) return
    running = true
    void (async () => {
        // Subscribe by ITERATING. Nothing else is wired: no connection, no handler registration.
        for await (const message of chatter) {
            // Unsubscribe by LEAVING the loop — `break` calls the iterator's `return`, detaching us.
            if (message === 'stop') break
            seen.push(message)
            if (seen.length > 8) seen.shift()
        }
        running = false
    })()
}

watchChatter()
// #enddemo

export function say(message: string): void {
    chatter.publish(message)
}

export function transcript(): { seen: string[]; running: boolean } {
    return { seen: [...seen], running }
}

export function restart(): void {
    seen.length = 0
    watchChatter()
}
