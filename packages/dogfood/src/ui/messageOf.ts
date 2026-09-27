// A refusal or a thrown error, as the sentence a page can print.
export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
