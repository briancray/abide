import type { HTTP_METHODS } from '../HTTP_METHODS.ts'

export type HttpMethod = (typeof HTTP_METHODS)[number]
