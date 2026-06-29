/*
Brand on the invoker cache() returns; its property value is the wrapped fn,
so inspection shows what a wrapper wraps. Detection is certain (set by us,
never heuristic), which is why misuse throws instead of warning: a wrapper
used as a selector matches nothing (no url/method, no producer id), and
without detection a re-wrapped wrapper would silently downgrade a remote to
an anonymous producer (no url/method, no shared key, no SSR snapshot).
*/
export const CACHE_WRAPPED: unique symbol = Symbol('abide.cacheWrapped')
