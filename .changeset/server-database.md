---
"@abide/abide": minor
---

`database(name, { migrations })` from `@abide/abide/server`: a lazy opener handing back bun's own `Database` for `<name>.sqlite` in `APP_DATA_DIR` — WAL, foreign keys and a busy timeout on open, each migration (SQL or a function) run once in one transaction tracked by `PRAGMA user_version`, a file a newer build migrated refused, an empty in-memory database per opener under `bun test`, and closed as the app stops (RULEBOOK 47).
