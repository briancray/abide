// Where this app's own directories ARE, for the cases that read them. The same leaf the dogfood app
// carries and for the same reason: a path computed as `${import.meta.dir}/..` is a rule that holds
// only while every case sits at one depth.

/** `packages/perf`. This file is at `src/tests/`, so two up. */
export const APP_ROOT = new URL('../..', import.meta.url).pathname

export const PAGES = `${APP_ROOT}/src/ui/pages`
export const APP_HTML = `${APP_ROOT}/src/ui/app.html`
