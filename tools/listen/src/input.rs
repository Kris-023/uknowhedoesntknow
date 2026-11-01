//! Small text editors: a single-line field, a password field and a multi-line paste area.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::text::Span;
use zeroize::Zeroizing;

/// A password field: no cursor movement, the value is wiped when dropped and never shown or logged
/// (Debug prints only the length).
#[derive(Clone, Default)]
pub struct SecretInput {
    value: Zeroizing<String>,
}

impl std::fmt::Debug for SecretInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretInput({} Zeichen)", self.len())
    }
}

impl SecretInput {
    pub fn len(&self) -> usize {
        self.value.chars().count()
    }

    pub fn is_empty(&self) -> bool {
        self.value.is_empty()
    }

    pub fn insert_str(&mut self, s: &str) {
        self.value.extend(s.chars().filter(|c| !c.is_control()));
    }

    /// The value; the field is empty afterwards.
    pub fn take(&mut self) -> Zeroizing<String> {
        std::mem::take(&mut self.value)
    }

    pub fn handle(&mut self, k: &KeyEvent) -> bool {
        match k.code {
            KeyCode::Char('u') if k.modifiers.contains(KeyModifiers::CONTROL) => {
                self.value = Zeroizing::default();
            }
            KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => self.value.push(c),
            KeyCode::Backspace => {
                self.value.pop();
            }
            _ => return false,
        }
        true
    }
}

/// One line with a cursor (in chars).
#[derive(Clone, Debug, Default)]
pub struct TextInput {
    pub value: String,
    pub cursor: usize,
}

impl TextInput {
    pub fn new(value: impl Into<String>) -> TextInput {
        let value = value.into();
        let cursor = value.chars().count();
        TextInput { value, cursor }
    }

    fn byte(&self, char_idx: usize) -> usize {
        self.value.char_indices().nth(char_idx).map(|(b, _)| b).unwrap_or(self.value.len())
    }

    pub fn insert_str(&mut self, s: &str) {
        // A single-line field: newlines and tabs from a paste become spaces.
        let clean: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
        let at = self.byte(self.cursor);
        self.value.insert_str(at, &clean);
        self.cursor += clean.chars().count();
    }

    pub fn clear(&mut self) {
        self.value.clear();
        self.cursor = 0;
    }

    /// Editing keys; returns false for keys it does not handle.
    pub fn handle(&mut self, k: &KeyEvent) -> bool {
        let len = self.value.chars().count();
        match k.code {
            KeyCode::Char('u') if k.modifiers.contains(KeyModifiers::CONTROL) => {
                let at = self.byte(self.cursor);
                self.value.replace_range(..at, "");
                self.cursor = 0;
            }
            KeyCode::Char('a') if k.modifiers.contains(KeyModifiers::CONTROL) => self.cursor = 0,
            KeyCode::Char('e') if k.modifiers.contains(KeyModifiers::CONTROL) => self.cursor = len,
            KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                self.insert_str(&c.to_string());
            }
            KeyCode::Backspace if self.cursor > 0 => {
                let (a, b) = (self.byte(self.cursor - 1), self.byte(self.cursor));
                self.value.replace_range(a..b, "");
                self.cursor -= 1;
            }
            KeyCode::Delete if self.cursor < len => {
                let (a, b) = (self.byte(self.cursor), self.byte(self.cursor + 1));
                self.value.replace_range(a..b, "");
            }
            KeyCode::Left => self.cursor = self.cursor.saturating_sub(1),
            KeyCode::Right => self.cursor = (self.cursor + 1).min(len),
            KeyCode::Home => self.cursor = 0,
            KeyCode::End => self.cursor = len,
            KeyCode::Backspace | KeyCode::Delete => {}
            _ => return false,
        }
        true
    }

    /// The visible part for a field `width` cells wide, and the cursor column within it.
    pub fn view(&self, width: u16) -> (String, u16) {
        let width = width.max(2) as usize;
        let chars: Vec<char> = self.value.chars().collect();
        let w = |s: &[char]| Span::raw(s.iter().collect::<String>()).width();
        let mut start = 0;
        while start < self.cursor && w(&chars[start..self.cursor]) > width - 1 {
            start += 1;
        }
        let mut end = start;
        while end < chars.len() && w(&chars[start..end + 1]) <= width {
            end += 1;
        }
        (chars[start..end].iter().collect(), w(&chars[start..self.cursor]) as u16)
    }
}

/// A multi-line area for pasting; typing always goes to the end.
#[derive(Clone, Debug, Default)]
pub struct PasteArea {
    pub text: String,
}

impl PasteArea {
    pub fn insert_str(&mut self, s: &str) {
        self.text.push_str(&s.replace("\r\n", "\n").replace('\r', "\n"));
    }

    pub fn handle(&mut self, k: &KeyEvent) -> bool {
        match k.code {
            KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => self.text.push(c),
            KeyCode::Enter => self.text.push('\n'),
            KeyCode::Backspace => {
                self.text.pop();
            }
            _ => return false,
        }
        true
    }

    pub fn lines(&self) -> Vec<&str> {
        let mut l: Vec<&str> = self.text.split('\n').collect();
        if l.is_empty() {
            l.push("");
        }
        l
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(c: KeyCode) -> KeyEvent {
        KeyEvent::new(c, KeyModifiers::NONE)
    }

    #[test]
    fn edits_with_umlauts() {
        let mut t = TextInput::new("Bär");
        t.handle(&key(KeyCode::Left));
        t.handle(&key(KeyCode::Backspace));
        assert_eq!(t.value, "Br");
        t.handle(&key(KeyCode::Char('ö')));
        assert_eq!(t.value, "Bör");
        t.insert_str("a\nb");
        assert_eq!(t.value, "Böa br");
        t.handle(&key(KeyCode::Home));
        t.handle(&key(KeyCode::Delete));
        assert_eq!(t.value, "öa br");
    }

    #[test]
    fn view_scrolls_to_the_cursor() {
        let t = TextInput::new("abcdefghij");
        let (s, x) = t.view(5);
        assert_eq!(s, "ghij");
        assert_eq!(x, 4);
        let mut t = TextInput::new("abcdefghij");
        t.cursor = 0;
        assert_eq!(t.view(5), ("abcde".to_string(), 0));
    }

    #[test]
    fn secret_input_hides_its_value() {
        let mut s = SecretInput::default();
        for c in "geheim1".chars() {
            s.handle(&key(KeyCode::Char(c)));
        }
        s.handle(&key(KeyCode::Backspace));
        s.insert_str("2\n");
        assert_eq!(format!("{s:?}"), "SecretInput(7 Zeichen)");
        assert_eq!(s.take().as_str(), "geheim2");
        assert!(s.is_empty());
    }

    #[test]
    fn paste_area() {
        let mut p = PasteArea::default();
        p.insert_str("a\r\nb");
        p.handle(&key(KeyCode::Enter));
        p.handle(&key(KeyCode::Char('c')));
        assert_eq!(p.lines(), vec!["a", "b", "c"]);
    }
}
