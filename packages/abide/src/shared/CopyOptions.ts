/**
 * What a `GET`'s browser copy has to behave by, as the build writes it into the wrapper.
 *
 * 18.4 — WHAT A `GET`'s VALUE DECLARES THAT ITS BROWSER COPY HAS TO BEHAVE BY, as the build reads
 * it off the declaration and writes it into the wrapper: data, because it crosses as text.
 * `deepEqual` is named rather than carried, being abide's own comparator on both sides; an app's
 * own has no serialization and stays the server's, as a function `key` or `tags` does.
 */
export type CopyOptions = {
    key?: string | undefined
    tags?: string[] | undefined
    identity?: 'deepEqual' | undefined
    /** 16.110 — the pace the copy starts a newly reached key at, as a `memo`'s window does (5.18). */
    throttle?: number | undefined
    debounce?: number | undefined
    /**
     * The handler is an async generator, so its answer is a stream the copy reads as it lands.
     *
     * 16.32.
     */
    stream?: true | undefined
    /**
     * 16.117 — the members a source's copy writes by, each to the verb it sends: `set`, `patch`,
     * `delete`, `run`, `push` or `append`, as its kind has them.
     */
    faces?: Readonly<Record<string, 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>> | undefined
    /** 16.117 — the copy's `set` and `patch` write the value it holds, as a memo's do. */
    held?: true | undefined
}
