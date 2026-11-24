/**
 * What a `GET`'s browser copy has to behave by, as the build writes it into the wrapper.
 *
 * 18.4 — WHAT A `GET`'s VALUE DECLARES THAT ITS BROWSER COPY HAS TO BEHAVE BY, as the build reads
 * it off the declaration and writes it into the wrapper: data, because it crosses as text.
 * `deepEqual` is named rather than carried, being abide's own comparator on both sides; an app's
 * own has no serialization and stays the server's, as a function `key` or `tags` does.
 */
export type CopyOptions = {
    key?: string
    tags?: string[]
    identity?: 'deepEqual'
    /**
     * The handler is an async generator, so its answer is a stream the copy reads as it lands.
     *
     * 16.32.
     */
    stream?: true
}
