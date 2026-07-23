use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

struct AbideExtension;

impl AbideExtension {
    // The project's own `abide` shim, if the package is installed into the worktree.
    fn local_binary(worktree: &zed::Worktree) -> Option<String> {
        let path = format!("{}/node_modules/.bin/abide", worktree.root_path());
        // No `stat` in the extension API — probing readability is the existence check.
        worktree.read_text_file(&path).ok().map(|_| path)
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
        // Resolution order: an explicit Zed settings override
        // (`"lsp": { "abide": { "binary": { path, arguments } } }`) wins; otherwise prefer the
        // project's `node_modules/.bin/abide`; fall back to `abide` on PATH. `abide lsp` (Bun)
        // forwards stdio to `node lsp.ts`, so pass the worktree's shell env — that keeps both
        // `abide` and `node` discoverable.
        let binary = LspSettings::for_worktree("abide", worktree)
            .ok()
            .and_then(|settings| settings.binary);

        let command = binary
            .as_ref()
            .and_then(|binary| binary.path.clone())
            .or_else(|| Self::local_binary(worktree))
            .or_else(|| worktree.which("abide"))
            .ok_or_else(|| "`abide` was not found in node_modules or PATH".to_string())?;

        let args = binary
            .and_then(|binary| binary.arguments)
            .unwrap_or_else(|| vec!["lsp".to_string()]);

        Ok(zed::Command {
            command,
            args,
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(AbideExtension);
