---
'@abide/abide': patch
---

`store.sqlite` takes a `database` opener — `store.sqlite(crmDatabase, 'target')` — and calls it at each `get` and `set`, so a store sharing the app's file keeps working after `App.stop` closed that `Database` and the app boots again in the same process (RULEBOOK 8.41). A string handed to `store.sqlite` is now opened by `database`, so it gets the test-time scratch file and abide's pragmas, and a bare name is `<name>.sqlite` in `APP_DATA_DIR` (8.42). `database(fn)` throws where `fn` hands back anything but a string, rather than opening `undefined.sqlite` (47.3), and `close({ remove: true })` deletes the file the opener last opened even after the app's stop closed it (47.17).
