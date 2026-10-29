---
"@abide/abide": patch
---

a value opening at a member of a name read by name — `reactive(route.url.searchParams.get('book') ?? '')`, `reactive(name.toUpperCase())` — is now a `Reactive` the file reads and writes by name, where before `abide check` refused every write as a string assigned to the `Reactive` and the build rebound the name instead of calling `set`
