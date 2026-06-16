use zed_extension_api::{self as zed, LanguageServerId, Result};

/*
The Abide Zed extension. Registers the `.abide` language (Svelte grammar for
highlighting) and spawns `abide lsp` as its language server, which publishes the
template + prop type-check diagnostics produced by the shadow type-checker.
*/
struct AbideExtension;

impl AbideExtension {
    /*
    Resolves the command that runs the language server. Prefers a `abide`
    executable on the worktree's PATH (a global install or `node_modules/.bin`);
    falls back to running the in-repo CLI through `bun` so the extension works
    while developing abide itself, where no `abide` binary is installed.
    */
    fn server_command(worktree: &zed::Worktree) -> Result<zed::Command> {
        let env = worktree.shell_env();
        if let Some(abide) = worktree.which("abide") {
            return Ok(zed::Command {
                command: abide,
                args: vec!["lsp".to_string()],
                env,
            });
        }
        let bun = worktree
            .which("bun")
            .ok_or_else(|| "abide LSP needs `abide` or `bun` on PATH".to_string())?;
        Ok(zed::Command {
            command: bun,
            args: vec![
                "packages/abide/bin/abide.ts".to_string(),
                "lsp".to_string(),
            ],
            env,
        })
    }
}

impl zed::Extension for AbideExtension {
    fn new() -> Self {
        AbideExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        AbideExtension::server_command(worktree)
    }
}

zed::register_extension!(AbideExtension);
