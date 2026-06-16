import { state } from '../state.ts'
import type { State } from './types/State.ts'

/* The current route as a reactive signal — read by `router` to pick the page,
   written by `navigate`/`popstate`. Defaults to `/` where there is no location
   (the server, which routes by request URL instead). */
export const runtimePath: State<string> = state(
    typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/',
)
