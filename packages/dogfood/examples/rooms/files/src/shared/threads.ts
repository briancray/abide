import { channel } from 'abide'
import { tooLong } from './failures.ts'

export type Post = { author: string; text: string }

// A CHANNEL is a space of rooms and `args` picks one, so this one
// declaration is every thread the app will ever have.
export const thread = channel<Post, { id: string }>({
    // Fifty past messages, which is also how far back a reconnect
    // can resume — a cursor older than the tail gets the whole
    // tail, never a gap.
    tail: 50,
    // The life of one retained message, each on its own clock.
    ttl: 3_600_000,
    // Runs on EVERY publish, the app's own included, and may
    // REFUSE by returning a `Failed` instead of a message.
    transform: (post) =>
        post.text.length > 500
            ? tooLong({ length: post.text.length })
            : post,
})
