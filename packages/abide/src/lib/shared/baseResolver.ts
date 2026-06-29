import { createResolverSlot } from './createResolverSlot.ts'

/*
The mount-base slot/resolver/reader bundle. The server entry installs an
APP_URL-derived resolver at boot; the client entry one reading
window.__SSR__.base. No lazy fallback creator — `fallback` is a plain string set
directly by isolated tests, and basePath() supplies the '' default. baseSlot /
basePath re-export the slot and reader; setBaseResolver the setter.
*/
export const baseResolver = createResolverSlot<string>()
