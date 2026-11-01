//! `ukhdk-listen`: terminal UI for the built-in decks of uKnowHeDoesntKnow.
//!
//! Works directly on the sealed `src/words/vault.json`: decrypts it in memory, checks edits with the
//! rules of scripts/seal-content.mjs, seals back, and pushes only the vault, merging with whatever
//! someone else pushed meanwhile. No plaintext touches the disk unless exported on request.

pub mod app;
pub mod content;
pub mod import;
pub mod input;
pub mod merge;
pub mod push;
pub mod ui;
pub mod validate;
pub mod vault;
