// abide's `messageOf`, spelled out because the bridge carries no abide at run time.
/** What a thrown value says: an `Error`'s message, or anything else as text. */
export function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown)
}
