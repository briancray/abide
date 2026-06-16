/*
Content-Type for the framework's plain-text responses (404, 405, CSRF refusal,
internal error). Explicit so intermediaries don't sniff the body and browsers
render it inline — a bodied Response with no Content-Type ships as
`application/octet-stream`, which the browser downloads instead of displaying.
*/
export const TEXT_PLAIN = 'text/plain; charset=utf-8'
