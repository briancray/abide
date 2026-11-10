---
"@abide/harness": minor
---

`@abide/harness/rows` no longer exports `BenchRow`, `RunnerFailure` or `isRunnerFailure`: no runner has written either row since the docs app's bench and test pages left, so the types described a contract nothing kept. `TestRow`, `TestCase`, `RowItem`, `RowState`, `inScope` and `matchesFilter` are unchanged.
