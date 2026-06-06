---
name: ship
description: One-shot release — stage all working-tree changes into logically-grouped conventional commits, then drive the belte changesets pipeline to a published npm version (push, version PR, merge, publish). Use when the user says "ship", "ship it", "release", "cut a version", "publish", or wants their pending changes turned into a new npm release with no further prompting.
---

# ship

Turns the current working tree into a published `@briancray/belte` version. Invoking this skill **authorizes the npm publish** — proceed through the merge without re-prompting, but report the version bump before merging as a sanity checkpoint.

## Preconditions

- On `main`. The Release workflow (`.github/workflows/release.yml`) only fires on push to `main`; a feature branch will not release. If not on `main`, stop and tell the user.
- `gh` authenticated, working tree may be dirty or clean.
- **Sync with origin first.** Run `git fetch origin` and check `git rev-list --left-right --count origin/main...HEAD`. A previous `/ship` merges the Version Packages PR on the remote (consuming the changeset files there), so local `main` is routinely behind and must not be built on:
  - Behind only (`N 0`) → `git rebase origin/main` (or fast-forward) before committing.
  - Diverged (`N M`, local commits not yet on origin) → `git rebase origin/main` to replay them on top. This is the case that drops the already-consumed `auto-*.md` changesets the remote deleted — verify `ls .changeset/*.md` shows only `README.md` afterward.
  - Conflicts → stop and surface them; do not force.

## Workflow

1. **Survey** — `git status` + `git diff` (and `git diff --staged`). Group changes by concern.
   - Per project rule (CLAUDE.md), **leave README/example-only changes unstaged** unless they are part of a code change being shipped or the user said to include them. Mention what you skipped.
   - If the tree is clean but unreleased commits exist since the last version bump, skip to step 4.

2. **Commit logically** — one conventional commit per concern. The subject drives the bump and changelog, so write it deliberately:
   - `feat:` → **minor**, everything else (`fix:`/`chore:`/`refactor:`/`docs:`/`perf:`) → **patch** (matches `scripts/autofillChangesets.ts` classify).
   - `feat!:` / `fix!:` or a `BREAKING CHANGE:` body stays minor (pre-1.0) but is flagged in notes.
   - Body: why + what, like the existing history. Stage explicit paths per commit (`git add <paths>`), never `git add -A` blindly across concerns.

3. **Gate locally** — run `bun test` and `bun run lint`. Both must be clean (lint warnings are fine, errors are not). Abort and report if tests fail — CI gates the publish on the same suite, so a red run just wastes a cycle.

4. **Generate changesets** — `bun run scripts/autofillChangesets.ts`. This is the critical bootstrap: the changesets action only versions when a changeset file already exists, but `autofillChangesets` normally runs *inside* `version-packages` (which never fires on a zero-changeset push). Running it here synthesizes `.changeset/auto-<hash>.md` from the new commits. It is idempotent — CI's re-run skips files that exist, so no duplication.
   - Commit them: `git commit -m "chore: add changesets for <summary>"`.

5. **Push once** — `git push origin main`. (Generating changesets *before* the push means one release run, not the wasted no-op run a changeset-less push produces.)

6. **Wait for the Version Packages PR**:
   ```
   until gh pr list --state open --limit 5 | grep -qi "changeset-release"; do sleep 5; done
   ```
   Then `gh pr diff <n>` — confirm the `## x.y.z` bump and that every changelog entry is present and not duplicated. Report the new version to the user.

7. **Merge** — `gh pr merge <n> --squash`. This push is what publishes to npm and cuts the GitHub Release.

8. **Confirm publish** — wait for the release run to complete, then verify in its log:
   ```
   rid=$(gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
   gh run view "$rid" --log | grep -iE "Publishing|published successfully|New tag"
   ```
   Report the published version + git tag (`@briancray/belte@x.y.z`). If the run failed, surface the failing step — do **not** retry the publish blindly.

## Notes

- Use an `until … sleep` loop for waits — chained foreground `sleep`s are blocked by the harness.
- Net bump = the highest of the per-commit bumps (one `feat` + several `fix` → minor).
- If `autofillChangesets` produces nothing, there is nothing releasable since the last version — tell the user instead of forcing an empty release.
