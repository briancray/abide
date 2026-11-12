---
"@abide/abide": minor
---

`database` opens a file wherever the app keeps it: its first argument is a name (`<name>.sqlite` in `APP_DATA_DIR`, as before), a path — anything holding a `/` or a `.`, relative to the working directory, so `todos.sqlite` is that file, `':memory:'`, or a function returning one, called as the file opens so it can read `config()` — RULEBOOK 47.2, 47.3, 47.12. Under `bun test` the scratch database still wins, and the function is not called (47.4). `{ openNewer: true }` opens a file a newer build migrated, running nothing and leaving `user_version` alone; the default still refuses it (47.9, 47.13).
