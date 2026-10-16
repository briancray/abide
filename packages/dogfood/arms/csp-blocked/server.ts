// THE POLICY, WRITTEN BY HAND, on every document and with a fresh nonce
// each time. Every directive is restated here, and a build that starts
// emitting an inline script is blocked until somebody edits this string.
const PAGE = await Bun.file(new URL('./index.html', import.meta.url)).text()

function policy(nonce: string): string {
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "style-src-attr 'unsafe-inline'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "form-action 'self'",
    ].join('; ')
}

Bun.serve({
    routes: {
        '/': () =>
            new Response(PAGE, {
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'content-security-policy': policy(
                        crypto.randomUUID().replaceAll('-', ''),
                    ),
                },
            }),
    },
})
