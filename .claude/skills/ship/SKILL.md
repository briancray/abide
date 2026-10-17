---
name: ship
description: One-shot release — stage all working-tree changes into logically-grouped conventional commits, then drive the changesets pipeline to a published npm version (push, version PR, merge, publish). Use when the user says "ship", "ship it", "release", "cut a version", "publish", or wants their pending changes turned into a new npm release with no further prompting.
---

# ship

Turns the current working tree into a published release. Three packages publish: `@abide/abide`
(`packages/abide`), `@abide/bridge` (`packages/bridge`) and `@abide/harness` (`packages/harness`);
`dogfood` is private.
`changeset publish` ships every package whose version is not on npm yet, and
`scripts/autofillChangesets.ts` attributes each commit to the package(s) whose shipped `files` it
touched. Invoking this skill **authorizes the npm publish** — proceed through the merge without
re-prompting, but report the per-package version bumps before merging as a sanity checkpoint.

## Preconditions

- On `main`. The Release workflow (`.github/workflows/release.yml`) only fires on push to `main`;
  a feature branch will not release. If not on `main`, stop and tell the user.
- `gh` authenticated; the working tree may be dirty or clean.
- Another session may share this tree — never `git add -A`; stage explicit paths.
- **Sync with origin first.** `git fetch origin`, then
  `git rev-list --left-right --count origin/main...HEAD`. A previous `/ship` merged the Version
  Packages PR on the remote (consuming the changeset files there), so local `main` is routinely
  behind:
  - Behind only (`N 0`) → `git rebase origin/main`.
  - Diverged (`N M`) → `git rebase origin/main`; afterwards `ls .changeset/*.md` shows only
    `README.md` unless a hand-written changeset is pending.
  - Conflicts → stop and surface them; do not force.

## Workflow

1. **Survey** — `git status`, `git diff`, `git diff --staged`. Group changes by concern. If the tree
   is clean but unreleased commits exist since the last `chore: version packages`, skip to step 4.

2. **Commit logically** — one conventional commit per concern. The subject is the changelog line
   and decides the bump:
   - `feat:` → **minor**, anything else (`fix:`/`chore:`/`refactor:`/`docs:`/`perf:`) → **patch**.
   - `feat!:` / `fix!:` or a `BREAKING CHANGE:` body stays minor (pre-1.0) and is flagged
     `Breaking:` in the notes.
   - Only commits touching a published package's `files` (`packages/abide/{src,bin,scaffold}`,
     `packages/bridge/{bin,src}`, `packages/harness/{src,scripts/buildInjectable.ts}`) become
     changelog entries — docs, tests and dogfood do not.

3. **Gate locally** — from the repo root: `bun run lint`, `bun run typecheck`, `bun run test`.
   All must be clean. CI's verify job runs the same three before
   anything publishes, so a red gate here only wastes a release run. A TIMING failure under
   `--parallel` is rerun with `bun run test:serial` before it is believed (CLAUDE.md, "checks").

4. **Generate changesets** — `bun run scripts/autofillChangesets.ts`. The changesets action only
   versions when a changeset file exists, and autofill otherwise runs only *inside*
   `version-packages`, which never fires on a changeset-less push. Idempotent (`auto-<hash>.md`).
   Commit them: `git commit -m "chore: add changesets for <summary>" -- .changeset`.

5. **Push once** — `git push origin main`. The `.githooks/pre-push` hook runs `bun run verify`
   (lint · typecheck · test); let it run.

6. **Wait for the Version Packages PR**:
   ```
   until gh pr list --state open --limit 5 | grep -qi "changeset-release"; do sleep 5; done
   ```
   Then `gh pr diff <n>` — confirm the `## x.y.z` bump for **each** package it versions and that
   every changelog entry is present once. Report the new version(s) to the user.
   - **If `@abide/bridge` is bumped**, the PR does not touch
     `packages/abide/src/server/BRIDGE_VERSION.ts`, and `assistant.test.ts` gates it equal to the
     bridge's `package.json` — so it cannot be bumped on `main` beforehand (the gate there would be
     red). Push the bump onto the PR branch from a worktree, then merge:
     ```
     br=$(gh pr view <n> --json headRefName -q .headRefName)
     git fetch origin "$br" && git worktree add /tmp/ship-wt "origin/$br"
     # edit BRIDGE_VERSION in /tmp/ship-wt to the PR's bridge version
     git -C /tmp/ship-wt commit -m "chore: the pairing command names @abide/bridge x.y.z" -- packages/abide/src/server/BRIDGE_VERSION.ts
     git -C /tmp/ship-wt push origin "HEAD:$br" && git worktree remove /tmp/ship-wt
     ```
     The release run's verify job gates the result before anything publishes.

7. **Merge** — `gh pr merge <n> --squash`. This push publishes to npm and cuts the GitHub Release.

8. **Confirm publish** — wait for the release run, then:
   ```
   rid=$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
   until [ "$(gh run view "$rid" --json status -q .status)" = completed ]; do sleep 10; done
   gh run view "$rid" --log | sed 's/.*Z //' | grep -A4 "Successfully published"
   ```
   (a `New tag` grep matches every historical tag the action fetches, not this release's.)
   Report each published version and tag (`@abide/abide@x.y.z`, `@abide/bridge@x.y.z`,
   `@abide/harness@x.y.z`); `npm view` can lag the publish by a minute or more. If the
   run failed, surface the failing step — do **not** retry the publish blindly.

## Notes

- Stage one hunk of a file shared by two concerns (RULEBOOK, REGISTRY) with
  `git diff <file> > f.diff`, keep the header plus the chosen `@@` hunks, `git apply --cached`.
  In zsh, a command held in a variable (`P="bun pick.ts"; $P …`) is not word-split — use a function.
- Use `until … sleep` loops for waits — chained foreground `sleep`s are blocked by the harness.
- Net bump per package = the highest per-commit bump touching it (one `feat` + several `fix` →
  minor).
- If autofill produces nothing, nothing releasable landed since the last version — tell the user
  rather than forcing an empty release.
