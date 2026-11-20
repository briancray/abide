/** What a thrown value says: an `Error`'s message, or anything else as text. */
export function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown)
}
