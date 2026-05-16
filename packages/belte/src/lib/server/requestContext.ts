// AsyncLocalStorage is canonical via node:async_hooks — Bun has no separate API
import { AsyncLocalStorage } from 'node:async_hooks'

export const requestContext = new AsyncLocalStorage<{ url: URL }>()
