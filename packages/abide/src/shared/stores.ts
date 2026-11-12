// 8.22, 8.34, 8.37 — the `Store`s a browser and a server both have, as `store`'s members. A member per
// module, so a page reading `store.web` loads that one and not its siblings (38.94).
export { cookies } from './stores/cookies.ts'
export { indexedDB } from './stores/indexedDB.ts'
export { web } from './stores/web.ts'
