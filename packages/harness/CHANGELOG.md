# @abide/harness

## 0.4.2

### Patch Changes

- d7a96bd: The test DOM opens and closes a popover: `showPopover`, `hidePopover` and `togglePopover` stand in for the methods happy-dom lacks, fire `toggle`, and `matches(':popover-open')` reads the open state — 43.36.
- Updated dependencies [eca6610]
- Updated dependencies [986bbcc]
- Updated dependencies [c1b702e]
- Updated dependencies [89d1e1c]
- Updated dependencies [f124040]
- Updated dependencies [e115489]
- Updated dependencies [7c23504]
- Updated dependencies [f145429]
- Updated dependencies [052d479]
- Updated dependencies [9d2dbe0]
- Updated dependencies [d58e7e7]
- Updated dependencies [8ec6774]
- Updated dependencies [084b78a]
- Updated dependencies [75c673f]
- Updated dependencies [9b3807a]
- Updated dependencies [09cd591]
- Updated dependencies [3f5fb1b]
- Updated dependencies [777a074]
- Updated dependencies [6b08f1a]
- Updated dependencies [761f7fe]
- Updated dependencies [56b1ce6]
- Updated dependencies [344ba20]
  - @abide/abide@0.130.0

## 0.4.1

### Patch Changes

- 068afc4: injectables built in memory, one reactive run, packDocs serves through serveDocsApp ([`289bfa2`](https://github.com/briancray/abide/commit/289bfa263bd2e979c637b36e97ff3937404768eb))
- 068afc4: one report build, one reactive format, shared row types ([`7d9b23a`](https://github.com/briancray/abide/commit/7d9b23ab3c2d6403c8ce8352439afce77a5e7987))
- 068afc4: drop the withdrawn `within`, one DOM setup for the bun-side counts, comments that state mechanism only ([`cb36d99`](https://github.com/briancray/abide/commit/cb36d99026346fbc5660bc33344f085b08e4bca5))
- 068afc4: drop the preload's happy-dom settings v21 makes inert — 43.35 ([`d668293`](https://github.com/briancray/abide/commit/d668293527d035181af802af701eecd98ebc5464))
- bf7c772: `abide scaffold` writes `tailwindcss` `^4.3.5`, and the harness's DOM preload registers happy-dom 21 — which fetches no stylesheet a parsed document names by default, so the preload no longer sets the deprecated `disableCSSFileLoading`.
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [068afc4]
- Updated dependencies [bf7c772]
- Updated dependencies [e32d563]
- Updated dependencies [c4ab17e]
- Updated dependencies [43ece1a]
- Updated dependencies [7e33ff2]
- Updated dependencies [b591e8b]
- Updated dependencies [444dedc]
- Updated dependencies [afad9a9]
  - @abide/abide@0.127.0

## 0.4.0

### Minor Changes

- d821e1e: `@abide/harness/rows` no longer exports `BenchRow`, `RunnerFailure` or `isRunnerFailure`: no runner has written either row since the docs app's bench and test pages left, so the types described a contract nothing kept. `TestRow`, `TestCase`, `RowItem`, `RowState`, `inScope` and `matchesFilter` are unchanged.

### Patch Changes

- 4920103: measure arms around its body without a case record; one data-write tally, one delta, one formatter, one substrate type ([`5ef1db9`](https://github.com/briancray/abide/commit/5ef1db9c643a956bfa371552c6f21ad6bdeec9b9))
- 4920103: round-2 leftovers — one eachArg role, one CLAUSE match, abide/bin scanned ([`806f9ab`](https://github.com/briancray/abide/commit/806f9ab6e7309b26183b0c745b073cb5580674ca))
- 7029630: `testRows` stops a test file still running ten minutes after it started and reports it as `broken`, rather than leaving its row at `running` for as long as the reader watches (43.27).
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [4920103]
- Updated dependencies [e957231]
- Updated dependencies [ba23c6f]
- Updated dependencies [a1d0354]
- Updated dependencies [3dad985]
- Updated dependencies [3cc3acb]
- Updated dependencies [e957231]
- Updated dependencies [f2cd7b7]
- Updated dependencies [e957231]
- Updated dependencies [3cc3acb]
- Updated dependencies [b93aad7]
- Updated dependencies [e957231]
- Updated dependencies [424f31b]
- Updated dependencies [2743db3]
  - @abide/abide@0.126.2

## 0.3.2

### Patch Changes

- 90356fb: a document parsed under the preload fetches no stylesheet or script it names — 43.35
- 90356fb: the preload leaves bun its own `WebSocket`, `TransformStream` and `WritableStream` — 43.28
- Updated dependencies [e948e8e]
- Updated dependencies [6f2742a]
- Updated dependencies [74eacfc]
- Updated dependencies [1eaf716]
- Updated dependencies [eb201fb]
- Updated dependencies [eb201fb]
- Updated dependencies [eb201fb]
- Updated dependencies [eb201fb]
- Updated dependencies [fd731a2]
- Updated dependencies [5d05e0e]
- Updated dependencies [c5ea214]
- Updated dependencies [17fdafe]
- Updated dependencies [693c7f3]
- Updated dependencies [20bb20a]
- Updated dependencies [b436c3e]
- Updated dependencies [c49316f]
- Updated dependencies [d3b0202]
- Updated dependencies [02f34f7]
- Updated dependencies [ce73c75]
- Updated dependencies [e93eaf6]
- Updated dependencies [92f7c58]
- Updated dependencies [801345f]
- Updated dependencies [26ebcb7]
- Updated dependencies [3ffb8c0]
- Updated dependencies [380be01]
- Updated dependencies [226e6a7]
- Updated dependencies [cbcd422]
- Updated dependencies [f215b78]
  - @abide/abide@0.125.0

## 0.3.1

### Patch Changes

- a9f8ad1: format the repo with abide format and bun fmt ([`d7cd46d`](https://github.com/briancray/abide/commit/d7cd46da1e0cd523631d38d923f8bb08d1f0716f))
- Updated dependencies [a9f8ad1]
- Updated dependencies [a9f8ad1]
- Updated dependencies [a9f8ad1]
  - @abide/abide@0.119.0

## 0.3.0

### Minor Changes

- 9e24653: `runBenches` (`@abide/harness/runner`) and the `harness-bench` command run every `*.bench.ts` under an app's `src`, print each arm's time and the claim between them, and fail the run where an arm goes over its `CEILINGS` entry or a ceiling names no arm (RULEBOOK 43.29-43.33); `abide scaffold` writes a `bench` script that runs it, and the starter's agent notes say to measure with the harness (RULEBOOK 38.124)

### Patch Changes

- 05ba855: a ceiling naming no bench fails the run, and a bench file sits beside any code it times (RULEBOOK 23.22, 43.32-43.34) ([`d5f3d3c`](https://github.com/briancray/abide/commit/d5f3d3cc6368057f8437559aafc7113abd2b3269))
- Updated dependencies [05ba855]
- Updated dependencies [05ba855]
- Updated dependencies [9e24653]
  - @abide/abide@0.117.1

## 0.2.2

### Patch Changes

- 3c32bf6: an element the client builds takes the namespace the parser gives it there — a component inside an svg draws — and an xlink:href it writes is XLink's; the harness counts createElementNS and setAttributeNS ([`0dd560a`](https://github.com/briancray/abide/commit/0dd560a35d54a86d8ff5d3bc7762ed6c6968c71f))
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
- Updated dependencies [3c32bf6]
  - @abide/abide@0.113.0

## 0.2.1

### Patch Changes

- fda92c3: a nested JUnit testsuite joins its file's suite, and signals are passed on only once a suite runs ([`35585df`](https://github.com/briancray/abide/commit/35585df23e3ec3f61fab714a953d8f3ff3244781))
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
- Updated dependencies [fda92c3]
  - @abide/abide@0.108.0

## 0.2.0

### Minor Changes

- 9aa03a5: publish @abide/harness, with abide's bench and e2e moved to abide and the arms to the docs app (43.1, 43.21, 43.23, 38.119) ([`8521bd7`](https://github.com/briancray/abide/commit/8521bd7b364d998a1a59f764b51b34cf273f7a84))

### Patch Changes

- 9aa03a5: the DOM preload keeps bun's fetch family (43.28) ([`f162931`](https://github.com/briancray/abide/commit/f162931f99aefff7caf2a651a0797cbcb2a83517))
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
- Updated dependencies [d42dfad]
- Updated dependencies [9aa03a5]
- Updated dependencies [9aa03a5]
  - @abide/abide@0.106.0
