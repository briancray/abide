/*
Brand on the invoker cache() returns; its property value is the wrapped fn,
so inspection shows what a wrapper wraps. Detection is certain (set by us,
never heuristic), which is why misuse throws instead of warning: a wrapper
used as a selector matches nothing (no url/method, no producer id), and a
re-wrapped wrapper silently downgrades a remote to an anonymous producer.
*/
export const CACHE_WRAPPED: unique symbol = Symbol('belte.cacheWrapped')
