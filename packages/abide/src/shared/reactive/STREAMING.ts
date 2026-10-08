/**
 * What `streamingOrSettled` answers once a value turns out to stream (9.20), told apart from a value
 * that settled to `undefined` — which is loaded, and so a settling of its own.
 */
export const STREAMING: unique symbol = Symbol('abide.streaming')
