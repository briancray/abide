import type { ApiHandler } from './ApiHandler.ts'

export type ApiModule = Partial<Record<string, ApiHandler>>
