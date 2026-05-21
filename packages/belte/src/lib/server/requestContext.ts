// AsyncLocalStorage is canonical via node:async_hooks — Bun has no separate API
import { AsyncLocalStorage } from 'node:async_hooks'
import type { RequestStore } from '../types/RequestStore.ts'

export const requestContext = new AsyncLocalStorage<RequestStore>()
