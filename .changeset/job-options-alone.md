---
"@abide/abide": minor
---

a `job` is handed its options alone, its name among them and now optional — `job({ name: 'digest', every, run })`, typed as the exported `JobOptions<Input>`, a failed run logged under `job` and that name where it is given — and what runs it ahead of its schedule is `Job.run`, where it was `runNow`; `abide upgrade --from 0.143.0` moves the name into the options and renames `runNow` (38.219)
