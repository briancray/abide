import type { HotInstance } from './types/HotInstance.ts'

/*
Live component instances grouped by module id (`UiComponent.__abideId`).
`mountChild` adds each instance it mounts while hot reload is active; `hotReplace`
walks a module's set to swap every instance when that module is edited. The set's
remove callback (filed with the mounting owner) drops an instance on unmount, so
no stale record survives to be swapped into a detached host.
*/
export const hotInstances: Map<string, Set<HotInstance>> = new Map()
