/* A read-only reactive cell computed from other cells. Reading `.value`
   subscribes the running observer and lazily recomputes if a dependency changed. */
export type Derived<T> = { readonly value: T }
