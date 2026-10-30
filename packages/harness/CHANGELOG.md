# @abide/harness

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
