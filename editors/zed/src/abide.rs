// The Zed end of `abide lsp`.
//
// This extension installs NOTHING. Every other language extension in Zed's registry downloads a
// server — an npm package, a release binary — and the version an editor checks against is then a
// second answer to a question the project already had one for. `abide lsp` is a subcommand of the
// binary the app depends on, so the server that reports a type error in a `.abide` file is built from
// the same compiler `bun test` runs, and there is no version to keep in step.
//
// So the whole of this file is one question: WHICH `abide` is this worktree's. Three answers, in the
// order that a wrong guess is cheapest to correct:
//
//   1. What the user said, in `lsp.abide.binary` — always first, because a setting nothing overrides
//      is a setting that does not work.
//   2. `node_modules/.bin/abide` — an app that depends on abide, which is the shape every app copying
//      `packages/dogfood` has.
//   3. The worktree's OWN `packages/abide/cli/index.ts` — abide's repo, which has no `abide` in its
//      root `node_modules/.bin` because the workspace link lands in each package's.
//   4. `abide` on `$PATH` — a global install.
//
// There is no fifth, and in particular there is no "download one": an abide the editor fetched for
// itself would type-check against a compiler the app never runs.
//
// Rule 3 is not a convenience, it is the rule that stops the silent version of exactly that failure.
// Without it, opening abide's own repo fell through to `$PATH` — and on the machine this was written
// on that resolves to a global install of a DIFFERENT checkout, whose server advertises semantic
// tokens and no completion at all. Nothing about that is visible in the editor: the highlighting is
// the grammar's either way, so the only symptom is a hover that disagrees with the compiler the tests
// run. A worktree that BUILDS abide must be served by the abide it builds.

use zed_extension_api::{self as zed, settings::LspSettings, Result};

struct AbideExtension;

/// The subcommand. `abide lsp` takes no arguments — which files to look at is the editor's to say,
/// over the wire — so this is the whole of the command line.
const LSP: &str = "lsp";

/// Where an app that DEPENDS on abide keeps the binary, via the `bin` entry in its `package.json`.
const LOCAL_BINARY: &str = "node_modules/.bin/abide";

/// The CLI's entry point inside abide's own repo — what `bun run cli` names, run the same way.
const SOURCE_ENTRY: &str = "packages/abide/cli/index.ts";

impl AbideExtension {
    /// What the user configured, or `None` to go on looking.
    ///
    /// A path with no arguments beside it still gets `lsp` appended: the setting exists to say WHICH
    /// abide, and having to remember the subcommand as well is a way to spell it wrong once.
    fn configured(worktree: &zed::Worktree) -> Option<zed::Command> {
        let binary = LspSettings::for_worktree("abide", worktree).ok()?.binary?;
        let path = binary.path?;
        Some(zed::Command {
            command: path,
            args: binary.arguments.unwrap_or_else(|| vec![LSP.to_string()]),
            env: binary
                .env
                .map(|env| env.into_iter().collect())
                .unwrap_or_else(|| worktree.shell_env()),
        })
    }
}

impl zed::Extension for AbideExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        if let Some(command) = Self::configured(worktree) {
            return Ok(command);
        }

        // Read rather than stat, because reading a file in the worktree is the only question this
        // sandbox can ask about one. What comes back is the shebang script Bun links; it is thrown
        // away, and the ANSWER is that the path resolved at all.
        if worktree.read_text_file(LOCAL_BINARY).is_ok() {
            return Ok(zed::Command {
                command: format!("{}/{}", worktree.root_path(), LOCAL_BINARY),
                args: vec![LSP.to_string()],
                // Carries `$PATH`, which is load-bearing rather than tidy: that path is a symlink to
                // a `.ts` file whose shebang is `#!/usr/bin/env bun`, so the kernel needs to find
                // `bun` to run it at all.
                env: worktree.shell_env(),
            });
        }

        // Before `$PATH`, so abide's own repo is served by its own source rather than by whatever a
        // global install happens to point at. `bun` runs the `.ts` directly, which is what the
        // `abide` script in that repo's `package.json` already does.
        if worktree.read_text_file(SOURCE_ENTRY).is_ok() {
            if let Some(bun) = worktree.which("bun") {
                return Ok(zed::Command {
                    command: bun,
                    args: vec![SOURCE_ENTRY.to_string(), LSP.to_string()],
                    env: worktree.shell_env(),
                });
            }
        }

        if let Some(path) = worktree.which("abide") {
            return Ok(zed::Command {
                command: path,
                args: vec![LSP.to_string()],
                env: worktree.shell_env(),
            });
        }

        // Named in full, because the failure an editor shows for a missing server is otherwise a
        // path somebody has to guess the shape of.
        Err(format!(
            "no `abide` binary for this worktree. Install it (`{LOCAL_BINARY}`), put `abide` on \
             $PATH, or set `lsp.abide.binary.path` in your Zed settings."
        )
        .into())
    }
}

zed::register_extension!(AbideExtension);
