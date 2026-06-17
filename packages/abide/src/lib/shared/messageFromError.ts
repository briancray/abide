/* A thrown value's human message: an Error's `.message`, otherwise the value
   coerced to a string. The one place the "how a non-Error surfaces to users"
   rule lives, instead of inlining `x instanceof Error ? x.message : String(x)`. */
export function messageFromError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
