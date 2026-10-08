// The headers a document starts from, a page's and an error page's alike. A leaf, because the page
// lane and the failure it answers in its place are two modules that have to agree on them.

// 21.3, 21.6, 21.18.
export const DOCUMENT_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "frame-ancestors 'none'",
    vary: 'accept-encoding',
}
