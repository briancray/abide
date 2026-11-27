/** The value of `request`'s cookie `name`, or `undefined`: read off the request alone, never the jar. */
export function cookieOf(request: Request, name: string): string | undefined {
    const header = request.headers.get('cookie')
    if (header === null) return undefined
    return new Bun.CookieMap(header).get(name) ?? undefined
}
