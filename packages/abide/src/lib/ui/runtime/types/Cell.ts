/* A stable reactive accessor bound to one document path: `get` subscribes the
   running observer, `set` mutates that path and wakes its readers — all path
   resolution done once at bind time, so the access itself is string-free. This
   is the shape the template compiler emits for a `{path}` read / write. */
export type Cell<T> = { get: () => T; set: (value: T) => void }
