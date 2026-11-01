//! `src/words/vault.json`: format, key derivation, sealing and opening, and the password.
//!
//! Byte compatible with src/words/vault.ts (the browser) and scripts/seal-content.mjs: AES-256-GCM
//! (12-byte IV, tag appended to the ciphertext like WebCrypto does), key from PBKDF2-HMAC-SHA256 over
//! the UTF-8 password, 16-byte salt, base64 fields, the file written like `JSON.stringify(v, null, 2)`.
//! The password and derived keys stay in memory and are wiped on drop; nothing here prints them.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig};
use base64::engine::DecodePaddingMode;
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::content::Content;

/// The vault, relative to the project root. The only file a push may contain.
pub const VAULT: &str = "src/words/vault.json";

/// Same as `ITERATIONS` in seal-content.mjs and `KDF_ITERATIONS` in vault.ts.
pub const ITERATIONS: u32 = 600_000;
pub const SALT_BYTES: usize = 16;
pub const IV_BYTES: usize = 12;

/// Writes standard base64 with padding (like `btoa`), reads it with or without padding (like `atob`).
const B64: GeneralPurpose =
    GeneralPurpose::new(&base64::alphabet::STANDARD, GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent));

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Kdf {
    pub name: String,
    pub hash: String,
    pub iterations: u32,
}

/// `Vault` in vault.ts. Field order is the key order the seal script writes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub format: String,
    pub v: u32,
    pub kdf: Kdf,
    pub cipher: String,
    pub salt: String,
    pub iv: String,
    pub data: String,
}

fn b64(s: &str) -> Option<Vec<u8>> {
    B64.decode(s.trim()).ok()
}

impl Vault {
    /// Parses and checks like `parseVault` in vault.ts.
    pub fn parse(text: &str) -> Result<Vault, String> {
        let v: Vault = serde_json::from_str(text).map_err(|e| format!("{VAULT} ist kein Tresor: {e}"))?;
        if v.format != "ukhdk-vault" || v.v != 1 || v.cipher != "AES-256-GCM" {
            return Err(format!("{VAULT} ist kein Tresor in Format 1 (AES-256-GCM)."));
        }
        if v.kdf.name != "PBKDF2" || v.kdf.hash != "SHA-256" || v.kdf.iterations < 1 {
            return Err(format!("{VAULT}: unbekannte Schlüsselableitung."));
        }
        if b64(&v.salt).is_none() || b64(&v.iv).map(|iv| iv.len()) != Some(IV_BYTES) || b64(&v.data).is_none() {
            return Err(format!("{VAULT}: salt, iv oder data ist kein gültiges base64."));
        }
        Ok(v)
    }

    pub fn salt_bytes(&self) -> Vec<u8> {
        b64(&self.salt).unwrap_or_default()
    }

    /// The file as the seal script writes it: two-space JSON plus a newline.
    pub fn to_text(&self) -> String {
        let mut s = serde_json::to_string_pretty(self).expect("plain fields always serialize");
        s.push('\n');
        s
    }
}

/// A derived AES key and the salt/iterations it belongs to.
pub struct Key {
    salt: Vec<u8>,
    iterations: u32,
    raw: Zeroizing<[u8; 32]>,
}

impl Key {
    pub fn derive(password: &str, salt: &[u8], iterations: u32) -> Key {
        let mut raw = Zeroizing::new([0u8; 32]);
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, iterations, raw.as_mut());
        Key { salt: salt.to_vec(), iterations, raw }
    }

    pub fn fits(&self, v: &Vault) -> bool {
        self.iterations == v.kdf.iterations && self.salt == v.salt_bytes()
    }

    pub fn salt(&self) -> &[u8] {
        &self.salt
    }
}

/// The decrypted bytes; None for a wrong key (GCM authentication fails) or broken fields.
pub fn decrypt(v: &Vault, key: &Key) -> Option<Zeroizing<Vec<u8>>> {
    let iv = b64(&v.iv)?;
    if iv.len() != IV_BYTES {
        return None;
    }
    let data = b64(&v.data)?;
    let cipher = Aes256Gcm::new_from_slice(key.raw.as_ref()).ok()?;
    cipher.decrypt(Nonce::from_slice(&iv), data.as_ref()).ok().map(Zeroizing::new)
}

/// Like `openVault` in vault.ts: decrypt, then check the shape. Err for a wrong key or broken content.
pub fn open(v: &Vault, key: &Key) -> Result<Content, OpenError> {
    let plain = decrypt(v, key).ok_or(OpenError::WrongKey)?;
    Content::from_json(&plain).map_err(OpenError::Broken)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenError {
    WrongKey,
    Broken(String),
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::WrongKey => write!(f, "Der Tresor geht mit diesem Passwort nicht auf."),
            OpenError::Broken(e) => write!(f, "{e}"),
        }
    }
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("the OS random source is available");
    b
}

/// Encrypts with a fresh IV under `key` (whose salt and iterations go into the file).
pub fn seal(content: &Content, key: &Key) -> Vault {
    let iv: [u8; IV_BYTES] = random_bytes();
    let plain = Zeroizing::new(content.to_json());
    let cipher = Aes256Gcm::new_from_slice(key.raw.as_ref()).expect("32-byte key");
    let data = cipher.encrypt(Nonce::from_slice(&iv), plain.as_ref()).expect("AES-GCM encryption of a few kB cannot fail");
    Vault {
        format: "ukhdk-vault".into(),
        v: 1,
        kdf: Kdf { name: "PBKDF2".into(), hash: "SHA-256".into(), iterations: key.iterations },
        cipher: "AES-256-GCM".into(),
        salt: B64.encode(&key.salt),
        iv: B64.encode(iv),
        data: B64.encode(data),
    }
}

/// The password in memory plus the keys derived from it so far (one PBKDF2 run per salt).
pub struct Keyring {
    password: Zeroizing<String>,
    keys: Vec<Key>,
}

impl Keyring {
    pub fn new(password: Zeroizing<String>) -> Keyring {
        Keyring { password, keys: Vec::new() }
    }

    /// The key for this vault's salt and iterations, derived once.
    pub fn key_for(&mut self, v: &Vault) -> &Key {
        let i = match self.keys.iter().position(|k| k.fits(v)) {
            Some(i) => i,
            None => {
                self.keys.push(Key::derive(&self.password, &v.salt_bytes(), v.kdf.iterations));
                self.keys.len() - 1
            }
        };
        &self.keys[i]
    }

    pub fn open(&mut self, v: &Vault) -> Result<Content, OpenError> {
        let key = self.key_for(v);
        open(v, key)
    }

    /// The key to seal over `current` with, like `previousSalt` in the seal script: its salt if it
    /// opens with this password and uses today's iteration count, else a new salt. True = new salt
    /// (everyone has to unlock again).
    pub fn seal_key(&mut self, current: Option<&Vault>) -> (&Key, bool) {
        let keep = current.filter(|v| v.kdf.iterations == ITERATIONS).is_some_and(|v| {
            let key = self.key_for(v);
            decrypt(v, key).is_some()
        });
        match current {
            Some(v) if keep => (self.key_for(v), false),
            _ => {
                let salt: [u8; SALT_BYTES] = random_bytes();
                self.keys.push(Key::derive(&self.password, &salt, ITERATIONS));
                (self.keys.last().expect("just pushed"), true)
            }
        }
    }
}

/// Seals `content` over `current` and opens the result again before anyone writes it. Returns the
/// file text and whether the salt is new.
pub fn seal_checked(ring: &mut Keyring, content: &Content, current: Option<&Vault>) -> Result<(String, bool), String> {
    let (key, new_salt) = ring.seal_key(current);
    let v = seal(content, key);
    let text = v.to_text();
    let back = Vault::parse(&text).and_then(|p| open(&p, key).map_err(|e| e.to_string()));
    match back {
        Ok(c) if &c == content => Ok((text, new_salt)),
        Ok(_) => Err("Selbsttest nach dem Versiegeln: der Tresor enthält nicht dasselbe. Nichts geschrieben.".into()),
        Err(e) => Err(format!("Selbsttest nach dem Versiegeln fehlgeschlagen ({e}). Nichts geschrieben.")),
    }
}

/// The password file the seal script uses: `$UKHDK_DECK_PASS_FILE` if set and not empty, else
/// `~/.config/ukhdk/deck-pass`.
pub fn pass_file_path(env: Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    match env.filter(|e| !e.is_empty()) {
        Some(p) => Some(PathBuf::from(p)),
        None => home.map(|h| h.join(".config").join("ukhdk").join("deck-pass")),
    }
}

pub fn default_pass_file() -> Option<PathBuf> {
    pass_file_path(std::env::var_os("UKHDK_DECK_PASS_FILE"), std::env::var_os("HOME").map(PathBuf::from))
}

pub struct PassFile {
    pub password: Zeroizing<String>,
    /// Group or others may read it (the seal script prints a hint then).
    pub loose: bool,
}

/// Never prints the password.
impl std::fmt::Debug for PassFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PassFile {{ loose: {} }}", self.loose)
    }
}

/// Reads the password like `readPassword` in the seal script: one trailing newline is not part of it,
/// fewer than 8 characters (UTF-16 units, as JavaScript counts) is refused. Ok(None): no such file.
pub fn read_pass_file(path: &Path) -> Result<Option<PassFile>, String> {
    let bytes = match fs::read(path) {
        Ok(b) => Zeroizing::new(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Passwortdatei {} nicht lesbar: {e}", path.display())),
    };
    let mut pw = Zeroizing::new(String::from_utf8_lossy(&bytes).into_owned());
    if pw.ends_with('\n') {
        pw.pop();
        if pw.ends_with('\r') {
            pw.pop();
        }
    }
    if pw.encode_utf16().count() < 8 {
        return Err(format!("Das Passwort in {} ist leer oder kürzer als 8 Zeichen.", path.display()));
    }
    #[cfg(unix)]
    let loose = {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).map(|m| m.permissions().mode() & 0o077 != 0).unwrap_or(false)
    };
    #[cfg(not(unix))]
    let loose = false;
    Ok(Some(PassFile { password: pw, loose }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{Entry, ListId};

    fn content() -> Content {
        let mut c = Content::empty();
        c.lists[ListId::WordsNormal.index()] = vec![Entry::card("Zebra", vec!["Streifen".into()])];
        c
    }

    #[test]
    fn seal_and_open_with_few_iterations() {
        let key = Key::derive("passwort-123", b"0123456789abcdef", 1000);
        let v = seal(&content(), &key);
        let text = v.to_text();
        assert!(text.starts_with("{\n  \"format\": \"ukhdk-vault\",\n  \"v\": 1,\n  \"kdf\": {\n    \"name\": \"PBKDF2\","));
        assert!(text.ends_with("\"\n}\n"));
        let back = Vault::parse(&text).unwrap();
        assert_eq!(open(&back, &key).unwrap(), content());
        let wrong = Key::derive("passwort-124", b"0123456789abcdef", 1000);
        assert_eq!(open(&back, &wrong), Err(OpenError::WrongKey));
        // A fresh IV every time.
        assert_ne!(seal(&content(), &key).iv, v.iv);
    }

    #[test]
    fn pbkdf2_matches_the_rfc_vector() {
        // RFC 7914 section 11: PBKDF2-HMAC-SHA256("passwd", "salt", 1, 64); first 32 bytes.
        let k = Key::derive("passwd", b"salt", 1);
        let hex: String = k.raw.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc");
    }

    #[test]
    fn parse_rejects_like_parse_vault() {
        let ok = r#"{"format":"ukhdk-vault","v":1,"kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":5},"cipher":"AES-256-GCM","salt":"c2FsdA==","iv":"AAAAAAAAAAAAAAAA","data":"ZGF0YQ"}"#;
        assert!(Vault::parse(ok).is_ok());
        assert!(Vault::parse(&ok.replace("AAAAAAAAAAAAAAAA", "aXY=")).is_err(), "iv must be 12 bytes");
        assert!(Vault::parse(&ok.replace("\"iterations\":5", "\"iterations\":0")).is_err());
        assert!(Vault::parse(&ok.replace("AES-256-GCM", "AES-128-GCM")).is_err());
        assert!(Vault::parse(&ok.replace("c2FsdA==", "!!")).is_err());
        assert!(Vault::parse(r#"{"format":"ukhdk-vault","v":1}"#).is_err());
    }

    #[test]
    fn password_file_rules() {
        let dir = std::env::temp_dir().join(format!("ukhdk-listen-pw-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("pass");
        assert!(read_pass_file(&f).unwrap().is_none());
        fs::write(&f, "geheim-123\r\n").unwrap();
        assert_eq!(read_pass_file(&f).unwrap().unwrap().password.as_str(), "geheim-123");
        fs::write(&f, "geheim-123\n\n").unwrap();
        assert_eq!(read_pass_file(&f).unwrap().unwrap().password.as_str(), "geheim-123\n", "only one newline is stripped");
        fs::write(&f, "kurz\n").unwrap();
        assert!(read_pass_file(&f).unwrap_err().contains("kürzer als 8"));
        // 4 emoji are 8 UTF-16 units: long enough for JavaScript, so here too.
        fs::write(&f, "🦓🦓🦓🦓").unwrap();
        assert!(read_pass_file(&f).is_ok());
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(
            pass_file_path(None, Some(PathBuf::from("/h"))),
            Some(PathBuf::from("/h").join(".config").join("ukhdk").join("deck-pass"))
        );
        assert_eq!(pass_file_path(Some("".into()), Some(PathBuf::from("/h"))), pass_file_path(None, Some(PathBuf::from("/h"))));
        assert_eq!(pass_file_path(Some("/x/y".into()), None), Some(PathBuf::from("/x/y")));
    }

    #[test]
    fn keyring_keeps_the_salt_for_the_same_password() {
        let mut ring = Keyring::new(Zeroizing::new("passwort-123".into()));
        let (text, new_salt) = seal_checked(&mut ring, &content(), None).unwrap();
        assert!(new_salt);
        let first = Vault::parse(&text).unwrap();
        let (text2, new_salt) = seal_checked(&mut ring, &content(), Some(&first)).unwrap();
        assert!(!new_salt);
        let second = Vault::parse(&text2).unwrap();
        assert_eq!(second.salt, first.salt);
        assert_ne!(second.iv, first.iv);
        let mut other = Keyring::new(Zeroizing::new("anderes-passwort".into()));
        assert_eq!(other.open(&second), Err(OpenError::WrongKey));
        let (text3, new_salt) = seal_checked(&mut other, &content(), Some(&second)).unwrap();
        assert!(new_salt);
        assert_ne!(Vault::parse(&text3).unwrap().salt, first.salt);
    }
}
