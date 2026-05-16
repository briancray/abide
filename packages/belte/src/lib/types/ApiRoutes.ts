import type { ApiModule } from './ApiModule.ts'

export type ApiRoutes = Record<string, () => Promise<ApiModule>>
