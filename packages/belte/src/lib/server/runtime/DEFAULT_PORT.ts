/*
The port scanning starts from when no PORT is configured. Every selector (the
real listener, the embedded launcher, the dev orchestrator) scans upward from
here so all modes land on the same predictable 3000+ address.
*/
export const defaultPort = 3000
