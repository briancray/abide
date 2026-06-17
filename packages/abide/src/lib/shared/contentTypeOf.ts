/* The `content-type` header, lowercased, or '' when absent — the canonical shape
   every content-type comparison in the codebase reads (case-insensitive match,
   no undefined to guard). */
export function contentTypeOf(headers: Headers): string {
    return (headers.get('content-type') ?? '').toLowerCase()
}
