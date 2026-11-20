// 52.44, 52.45 — THE ZONE A DATE IS WRITTEN IN WHERE ITS CALLER NAMES NONE. The app pins one by
// writing `format.timeZone` — in a layout's setup, which runs on both sides, so the two agree.
// Unpinned, it is the visitor's own: the server cannot know it, so it answers UTC there and while the
// page hydrates, and the browser's zone once it has (41.32) — every date read in a template written
// again in the visitor's time.
//
// PURE, as `online` is, so an app that formats no date does not ship the listener-free stand-in.

import { hydratedValue } from '../hydrating.ts'
import { ambient } from '../reactive/index.ts'

const SERVER_ZONE = 'UTC'

/** The zone the app pins every date to, or `undefined` for the visitor's own. Per request on a server. */
export const timeZone = /* @__PURE__ */ ambient<string | undefined>(undefined)

const browserZone = (): string =>
    Intl.DateTimeFormat().resolvedOptions().timeZone

/** The visitor's zone: UTC on a server and while the page hydrates, the browser's after. */
export const visitorZone = /* @__PURE__ */ hydratedValue(
    SERVER_ZONE,
    browserZone,
).value
