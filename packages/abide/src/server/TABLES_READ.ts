/**
 * 47.39 — a handler to every table a run of it has read, which a change to any of them sweeps the
 * followers of as a tag would: a handler the server holds no value of between requests has no run
 * standing to refresh, and its copies are what the change is for.
 */
export const TABLES_READ = new WeakMap<object, Set<string>>()
