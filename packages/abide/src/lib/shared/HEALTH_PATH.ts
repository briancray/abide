/*
The canonical liveness/health endpoint: the identity payload plus whatever
the app's optional `health(request)` hook contributes. `/__abide/identity`
stays as a compatibility alias serving the same payload (older launchers
probe it; probeAbideServer falls back to it for older servers).
*/
export const HEALTH_PATH = '/__abide/health'
