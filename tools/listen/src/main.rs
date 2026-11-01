use std::io::stdout;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use crossterm::event::{self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture};
use crossterm::execute;
use ukhdk_listen::app::App;
use ukhdk_listen::ui;
use ukhdk_listen::vault::{default_pass_file, VAULT};

const USAGE: &str = "ukhdk-listen – eingebaute Stapel bearbeiten, versiegeln und pushen

Aufruf:  npm run listen            (im Projektordner)
         ukhdk-listen [--root <projektordner>]

--root   Projektordner mit src/words/vault.json (Standard: aktueller Ordner oder ein Ordner darüber).
Passwort: aus der Datei von npm run seal ($UKHDK_DECK_PASS_FILE, sonst ~/.config/ukhdk/deck-pass),
          sonst fragt das Programm. Es bleibt nur im Speicher.
Tasten:  ? im Programm.";

/// The project root: `--root`, else the first folder upwards from here with the seal script.
fn find_root() -> Result<PathBuf> {
    let mut args = std::env::args().skip(1);
    let mut root = None;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--root" => root = Some(PathBuf::from(args.next().context("--root braucht einen Ordner")?)),
            "-h" | "--help" => {
                println!("{USAGE}");
                std::process::exit(0);
            }
            other => bail!("Unbekanntes Argument: {other}\n\n{USAGE}"),
        }
    }
    if let Some(r) = root {
        return Ok(r);
    }
    let here = std::env::current_dir()?;
    here.ancestors()
        .find(|d| d.join("scripts/seal-content.mjs").is_file() && d.join(VAULT).is_file())
        .map(Path::to_path_buf)
        .context("Kein Projektordner gefunden (mit scripts/seal-content.mjs und src/words/vault.json). --root angeben.")
}

fn restore() {
    let _ = execute!(stdout(), DisableMouseCapture, DisableBracketedPaste);
    ratatui::restore();
}

fn main() -> Result<()> {
    let root = find_root()?;
    // Load before touching the terminal, so a missing vault is a plain error message.
    let mut app = App::open(&root, default_pass_file().as_deref())?;

    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore();
        hook(info);
    }));
    let mut terminal = ratatui::init();
    execute!(stdout(), EnableMouseCapture, EnableBracketedPaste)?;
    let result = (|| -> Result<()> {
        loop {
            terminal.draw(|f| ui::draw(f, &mut app))?;
            if app.quit {
                return Ok(());
            }
            if app.has_work() {
                app.tick();
                continue;
            }
            app.handle_event(event::read()?);
        }
    })();
    restore();
    result
}
