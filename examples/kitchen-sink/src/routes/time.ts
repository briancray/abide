import type { ApiHandler } from 'belte/types/ApiHandler'

export const GET: ApiHandler = () => Response.json({ now: new Date().toISOString() })
