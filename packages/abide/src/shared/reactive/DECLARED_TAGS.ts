/**
 * A value built with `tags`, and a `GET` serving one, to the `tags` it was declared with — the list,
 * or the function of its `Args`.
 *
 * 13.15 — what a server sweep matches a browser's follow by: the function form evaluated over the
 * args that follow names, which no build can copy onto the browser's copy (18.4).
 */
export const DECLARED_TAGS = new WeakMap<
    object,
    string[] | ((args: never) => string[])
>()
