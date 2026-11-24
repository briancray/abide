---
"@abide/harness": minor
---

`Bench`, from `@abide/harness/runner`, names one row `runBenches` answers — its file, case, `n`, floor, each arm's time per operation, the claim and what went over a ceiling — so a reader of the results writes `Bench` rather than `Awaited<ReturnType<typeof runBenches>>[number]`.
