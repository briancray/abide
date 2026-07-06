import { createResolverSlot } from './createResolverSlot.ts'

/*
The mount-base slot. The server entry installs an APP_URL-derived resolver at
boot; the client entry one reading window.__SSR__.base. No lazy fallback
creator — `.fallback` is a plain string set directly by isolated tests, and
basePath() (the public read) supplies the '' default.
*/
export const baseSlot = createResolverSlot<string>()
