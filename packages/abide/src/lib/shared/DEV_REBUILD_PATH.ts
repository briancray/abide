/*
Dev-only manual-rebuild trigger: POSTing here signals the orchestrator to rebuild +
restart. Mounted only under `abide dev`. Shared so the router mount and the launcher's
"POST … to apply" hint name the one path.
*/
export const DEV_REBUILD_PATH = '/__abide/reload'
