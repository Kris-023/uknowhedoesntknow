//! Drawing. All texts the user sees are German.

use ratatui::layout::{Constraint, Layout, Position, Rect};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Cell, Clear, Paragraph, Row, Table, Wrap};
use ratatui::Frame;

use crate::app::{App, Focus, Form, Import, Modal, Preview, Push, PushStage, Tone, Unlock};
use crate::content::Kind;
use crate::import::Status;
use crate::merge::{Choice, State};
use crate::push::LogKind;
use crate::validate::{max_chars, MAX_TABOO};
use crate::vault::VAULT;

const ACCENT: Color = Color::Cyan;
const DIM: Color = Color::DarkGray;
const BAD: Color = Color::Red;
const DUP: Color = Color::Yellow;
const GOOD: Color = Color::Green;

pub fn draw(f: &mut Frame, app: &mut App) {
    let footer_lines = hints(&keys_for(app), f.area().width);
    if let Modal::Unlock(u) = &app.modal {
        let [main, footer] = Layout::vertical([Constraint::Min(5), Constraint::Length(footer_lines.len() as u16)]).areas(f.area());
        draw_unlock(f, u, main);
        f.render_widget(Paragraph::new(footer_lines), footer);
        return;
    }
    let [main, status, footer] =
        Layout::vertical([Constraint::Min(5), Constraint::Length(1), Constraint::Length(footer_lines.len() as u16)]).areas(f.area());
    let [left, right] = Layout::horizontal([Constraint::Length(28), Constraint::Min(20)]).areas(main);
    draw_lists(f, app, left);
    draw_entries(f, app, right);
    draw_status(f, app, status);
    f.render_widget(Paragraph::new(footer_lines), footer);
    match &app.modal {
        Modal::None | Modal::Unlock(_) => {}
        Modal::Help => draw_help(f),
        Modal::Confirm(c) => {
            let lines: Vec<Line> = c.lines.iter().map(|l| Line::from(l.as_str())).collect();
            let w = c.lines.iter().map(|l| l.chars().count()).max().unwrap_or(20).max(30) as u16 + 4;
            let area = centered(f.area(), w, c.lines.len() as u16 + 3);
            f.render_widget(Clear, area);
            f.render_widget(
                Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .block(popup(&c.title).title_bottom(Line::from(" j = ja · n = nein ").centered())),
                area,
            );
        }
        Modal::Form(form) => draw_form(f, form),
        Modal::Import(Import::Input { file_mode, area, path, error }) => {
            draw_import_input(f, *file_mode, area.lines(), path, error.as_deref())
        }
        Modal::Import(Import::Preview(p)) => {
            let mut p = p.clone();
            draw_preview(f, &mut p);
            if let Modal::Import(Import::Preview(orig)) = &mut app.modal {
                orig.table = p.table;
            }
        }
        Modal::MoveTo { from, targets, sel, .. } => {
            let area = centered(f.area(), 40, targets.len() as u16 + 4);
            f.render_widget(Clear, area);
            let mut lines = vec![Line::from(format!("Von {} nach:", from.title()))];
            for (i, t) in targets.iter().enumerate() {
                let st = if i == *sel { Style::new().reversed() } else { Style::new() };
                lines.push(Line::styled(format!(" {} {} ", i + 1, t.title()), st));
            }
            f.render_widget(Paragraph::new(lines).block(popup("Verschieben")), area);
        }
        Modal::Push(_) => draw_push(f, app),
    }
}

fn popup(title: &str) -> Block<'static> {
    Block::bordered().border_type(BorderType::Rounded).border_style(Style::new().fg(ACCENT)).title(Line::from(format!(" {title} ")).bold())
}

fn centered(area: Rect, w: u16, h: u16) -> Rect {
    let w = w.min(area.width);
    let h = h.min(area.height);
    Rect::new(area.x + (area.width - w) / 2, area.y + (area.height - h) / 2, w, h)
}

fn pct(area: Rect, w: u16, h: u16) -> Rect {
    centered(area, area.width * w / 100, area.height * h / 100)
}

fn pane(title: Line<'static>, focused: bool) -> Block<'static> {
    let b = Block::bordered().border_type(BorderType::Rounded).title(title);
    if focused {
        b.border_style(Style::new().fg(ACCENT))
    } else {
        b.border_style(Style::new().fg(DIM))
    }
}

fn draw_lists(f: &mut Frame, app: &mut App, area: Rect) {
    let block = pane(Line::from(" Listen ").bold(), app.focus == Focus::Lists && matches!(app.modal, Modal::None));
    let inner = block.inner(area);
    f.render_widget(block, area);
    let mut lines: Vec<Line> = Vec::new();
    let mut rows = Vec::new();
    for kind in Kind::ALL {
        lines.push(Line::from(kind.label()).bold());
        for &id in kind.lists() {
            let n = app.content.count(id);
            let problems = app.report.count(id);
            let mut spans = vec![
                Span::styled(format!(" {} ", id.index() + 1), Style::new().fg(DIM)),
                Span::raw(format!("{:<8}", id.variant())),
                Span::raw(format!("{n:>4}")),
            ];
            spans.push(if app.is_dirty(id) { Span::styled(" ●", Style::new().fg(DUP)) } else { Span::raw("  ") });
            if problems > 0 {
                spans.push(Span::styled(format!(" ⚠{problems}"), Style::new().fg(BAD)));
            }
            let mut line = Line::from(spans);
            if id == app.current {
                line = line.style(Style::new().add_modifier(Modifier::REVERSED));
            }
            rows.push((inner.y + lines.len() as u16, id));
            lines.push(line);
        }
    }
    lines.push(Line::raw(""));
    let dirty = app.dirty_lists().len();
    lines.push(Line::from(vec![Span::styled("● ", Style::new().fg(DUP)), Span::styled("= nicht versiegelt", Style::new().fg(DIM))]));
    if dirty > 0 {
        lines.push(Line::styled(format!("{dirty} {} nicht versiegelt", if dirty == 1 { "Liste" } else { "Listen" }), Style::new().fg(DUP)));
    } else if app.unpushed() {
        lines.push(Line::styled("versiegelt, nicht gepusht", Style::new().fg(ACCENT)));
    }
    let problems = app.report.total();
    if problems > 0 {
        lines.push(Line::styled(format!("⚠ {problems} Probleme"), Style::new().fg(BAD)));
    } else {
        lines.push(Line::styled("✓ alles gültig", Style::new().fg(GOOD)));
    }
    f.render_widget(Paragraph::new(lines), inner);
    app.hits.lists = area;
    app.hits.list_rows = rows;
}

fn draw_entries(f: &mut Frame, app: &mut App, area: Rect) {
    let id = app.current;
    let kind = id.kind();
    let visible = app.visible();
    let total = app.content.count(id);
    let mut title = vec![Span::raw(" "), Span::raw(id.title()).bold(), Span::raw(format!(" · {total} Einträge "))];
    if !app.filter.value.is_empty() {
        title.push(Span::styled(format!("· Filter „{}“: {} ", app.filter.value, visible.len()), Style::new().fg(ACCENT)));
    }
    if app.is_dirty(id) {
        title.push(Span::styled("· nicht versiegelt ", Style::new().fg(DUP)));
    }
    let block = pane(Line::from(title), app.focus == Focus::Entries && matches!(app.modal, Modal::None));
    let inner = block.inner(area);
    f.render_widget(block, area);

    let globals: Vec<&String> = app.report.global.iter().filter(|(l, _)| *l == id).map(|(_, m)| m).collect();
    let [top, table_area, bottom] =
        Layout::vertical([Constraint::Length(globals.len() as u16), Constraint::Min(1), Constraint::Length(u16::from(app.filtering))])
            .areas(inner);
    f.render_widget(Paragraph::new(globals.iter().map(|m| Line::styled(format!("⚠ {m}"), Style::new().fg(BAD))).collect::<Vec<_>>()), top);

    let entries = app.content.entries(id);
    let has_issue = visible.iter().any(|&i| app.report.issue(id, i).is_some());
    let rows: Vec<Row> = visible
        .iter()
        .map(|&i| {
            let e = &entries[i];
            let issue = app.report.issue(id, i);
            let style = match issue {
                Some(x) if x.dup => Style::new().fg(DUP),
                Some(_) => Style::new().fg(BAD),
                None => Style::new(),
            };
            let mut cells = vec![Cell::from(format!("{:>4}", i + 1)).style(Style::new().fg(DIM)), Cell::from(e.text.clone())];
            if kind == Kind::Words {
                cells.push(Cell::from(e.taboo_joined()).style(Style::new().fg(Color::Gray)));
            }
            if has_issue {
                cells.push(Cell::from(issue.map(|x| x.msg.clone()).unwrap_or_default()));
            }
            Row::new(cells).style(style)
        })
        .collect();
    let longest = visible.iter().map(|&i| entries[i].text.chars().count()).max().unwrap_or(10) as u16;
    let mut widths = vec![Constraint::Length(4)];
    let mut header = vec!["  Nr"];
    if kind == Kind::Words {
        widths.push(Constraint::Length(longest.clamp(8, 24)));
        widths.push(Constraint::Fill(1));
        header.extend(["Begriff", "Verbotene Wörter"]);
    } else {
        widths.push(Constraint::Fill(1));
        header.push(match kind {
            Kind::Zeig => "Wer würde am ehesten …",
            Kind::Gleich => "Frage",
            _ => "Kategorie",
        });
    }
    if has_issue {
        let longest_issue = visible.iter().filter_map(|&i| app.report.issue(id, i)).map(|x| x.msg.chars().count()).max().unwrap_or(10);
        widths.push(Constraint::Length(longest_issue.clamp(10, 48) as u16));
        header.push("Problem");
    }
    let empty = rows.is_empty();
    let table = Table::new(rows, widths)
        .header(Row::new(header).style(Style::new().fg(DIM).add_modifier(Modifier::BOLD)))
        .row_highlight_style(Style::new().add_modifier(Modifier::REVERSED))
        .column_spacing(1);
    app.table.select(if empty { None } else { Some(app.row[id.index()]) });
    f.render_stateful_widget(table, table_area, &mut app.table);
    if empty {
        let msg =
            if total == 0 { "Leer. a legt den ersten Eintrag an, i importiert." } else { "Nichts passt zum Filter. Esc löscht ihn." };
        f.render_widget(Paragraph::new(Line::styled(msg, Style::new().fg(DIM))), Rect { y: table_area.y + 1, height: 1, ..table_area });
    }
    app.hits.entries = area;
    app.hits.table_top = table_area.y + 1;

    if app.filtering {
        let label = "Filter: ";
        let w = bottom.width.saturating_sub(label.len() as u16);
        let (text, cx) = app.filter.view(w);
        f.render_widget(Paragraph::new(Line::from(vec![Span::styled(label, Style::new().fg(ACCENT)), Span::raw(text)])), bottom);
        f.set_cursor_position(Position::new(bottom.x + label.len() as u16 + cx, bottom.y));
    }
}

fn draw_status(f: &mut Frame, app: &App, area: Rect) {
    if let Some((tone, msg)) = &app.status {
        let color = match tone {
            Tone::Info => Color::Gray,
            Tone::Ok => GOOD,
            Tone::Error => BAD,
        };
        f.render_widget(Paragraph::new(Line::styled(format!(" {msg}"), Style::new().fg(color))), area);
    }
}

/// Key hints for the footer: (key, what).
fn keys_for(app: &App) -> Vec<(&'static str, &'static str)> {
    match &app.modal {
        Modal::None if app.filtering => vec![("tippen", "filtern"), ("Enter", "fertig"), ("Esc", "Filter löschen")],
        Modal::None => {
            let mut k = vec![
                ("↑↓", "wählen"),
                ("Tab", "Listen/Einträge"),
                ("a", "neu"),
                ("e", "bearbeiten"),
                ("d", "löschen"),
                ("m", "verschieben"),
                ("/", "suchen"),
                ("i", "import"),
            ];
            if app.can_undo() {
                k.push(("u", "rückgängig"));
            }
            k.extend([("s", "versiegeln"), ("p", "pushen"), ("?", "Hilfe"), ("q", "beenden")]);
            k
        }
        Modal::Unlock(u) if u.checking => vec![("", "prüfe …")],
        Modal::Unlock(_) => vec![("Enter", "entsperren"), ("Esc", "beenden")],
        Modal::Help => vec![("beliebige Taste", "schließen")],
        Modal::Confirm(_) => vec![("j", "ja"), ("n/Esc", "nein")],
        Modal::Form(_) => vec![("Tab", "nächstes Feld"), ("Enter", "übernehmen"), ("Esc", "abbrechen")],
        Modal::Import(Import::Input { file_mode: false, .. }) => {
            vec![("Strg+S", "Vorschau"), ("Tab", "Datei statt Einfügen"), ("Esc", "abbrechen")]
        }
        Modal::Import(Import::Input { file_mode: true, .. }) => {
            vec![("Enter", "Vorschau"), ("Tab", "Einfügen statt Datei"), ("Esc", "abbrechen")]
        }
        Modal::Import(Import::Preview(_)) => vec![("←→", "Zielliste"), ("↑↓", "blättern"), ("Enter/j", "übernehmen"), ("Esc/n", "zurück")],
        Modal::MoveTo { .. } => vec![("↑↓/1-3", "Ziel"), ("Enter", "verschieben"), ("Esc", "abbrechen")],
        Modal::Push(p) => match p.stage {
            PushStage::AskStart(_) | PushStage::AskPush(_) => vec![("j", "ja"), ("n/Esc", "nein"), ("↑↓", "Protokoll blättern")],
            PushStage::AskPassword => vec![("Enter", "prüfen"), ("Esc", "abbrechen")],
            PushStage::Merge => vec![
                ("↑↓", "Konflikt wählen"),
                ("←/m", "meine Version"),
                ("→/t", "andere Version"),
                ("Enter", "weiter"),
                ("Esc", "abbrechen"),
            ],
            PushStage::Run(_) => vec![("", "läuft …")],
            PushStage::Done(_) => vec![("Enter/Esc", "schließen"), ("↑↓", "Protokoll blättern")],
        },
    }
}

/// Key hints, wrapped onto as many lines as the width needs (never splitting a key from its label).
fn hints(keys: &[(&'static str, &'static str)], width: u16) -> Vec<Line<'static>> {
    let mut lines = vec![Line::raw(" ")];
    for (k, what) in keys {
        let mut chunk = Vec::new();
        if !k.is_empty() {
            chunk.push(Span::styled(*k, Style::new().fg(Color::Black).bg(ACCENT)));
            chunk.push(Span::raw(" "));
        }
        chunk.push(Span::styled(*what, Style::new().fg(Color::Gray)));
        chunk.push(Span::raw("  "));
        let w: usize = chunk.iter().map(Span::width).sum();
        let last = lines.last_mut().expect("one line");
        if last.width() + w > width as usize && last.width() > 1 {
            lines.push(Line::from(vec![Span::raw(" ")]));
        }
        lines.last_mut().expect("one line").spans.extend(chunk);
    }
    lines
}

fn draw_field(f: &mut Frame, area: Rect, input: &crate::input::TextInput, focused: bool) {
    let (text, cx) = input.view(area.width.saturating_sub(1));
    let style =
        if focused { Style::new().bg(Color::Indexed(236)).fg(Color::White) } else { Style::new().bg(Color::Indexed(234)).fg(Color::Gray) };
    f.render_widget(Paragraph::new(text).style(style), area);
    if focused {
        f.set_cursor_position(Position::new(area.x + cx, area.y));
    }
}

fn draw_form(f: &mut Frame, form: &Form) {
    let kind = form.list.kind();
    let what = if form.idx.is_some() { "bearbeiten" } else { "neu" };
    let area = centered(f.area(), 76, if kind == Kind::Words { 11 } else { 8 });
    f.render_widget(Clear, area);
    let block = popup(&format!("{} {what} · {}", kind.one(), form.list.title()));
    let inner = block.inner(area);
    f.render_widget(block, area);
    let labels: Vec<String> = match kind {
        Kind::Words => vec![
            format!("Begriff (höchstens {} Zeichen, ohne Doppelpunkt)", max_chars(kind)),
            format!("Verbotene Wörter, mit Komma getrennt (1 bis {MAX_TABOO})"),
        ],
        Kind::Zeig => vec![format!("Ende von „Wer würde am ehesten …?“ (höchstens {} Zeichen)", max_chars(kind))],
        Kind::Gleich => vec![format!("Frage (höchstens {} Zeichen)", max_chars(kind))],
        Kind::Slf => vec![format!("Kategorie (höchstens {} Zeichen)", max_chars(kind))],
    };
    let mut y = inner.y;
    for (i, label) in labels.iter().enumerate() {
        let n = form.fields[i].value.chars().count();
        let counter = if i == 0 {
            format!("  {n}/{}", max_chars(kind))
        } else {
            format!("  {}", crate::import::taboo_field(&form.fields[1].value).len())
        };
        f.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(label.clone(), Style::new().fg(Color::Gray)),
                Span::styled(counter, Style::new().fg(DIM)),
            ])),
            Rect::new(inner.x, y, inner.width, 1),
        );
        draw_field(f, Rect::new(inner.x, y + 1, inner.width, 1), &form.fields[i], form.focus == i);
        y += 3;
    }
    let msg = match &form.error {
        Some(e) => Line::styled(format!("⚠ {e}"), Style::new().fg(BAD)),
        None => Line::styled("Enter übernimmt · Esc bricht ab", Style::new().fg(DIM)),
    };
    f.render_widget(Paragraph::new(msg), Rect::new(inner.x, inner.y + inner.height.saturating_sub(1), inner.width, 1));
}

fn draw_import_input(f: &mut Frame, file_mode: bool, lines: Vec<&str>, path: &crate::input::TextInput, error: Option<&str>) {
    let area = pct(f.area(), 85, 80);
    f.render_widget(Clear, area);
    let block = popup("Importieren");
    let inner = block.inner(area);
    f.render_widget(block, area);
    let [tabs, help, body, err] =
        Layout::vertical([Constraint::Length(2), Constraint::Length(3), Constraint::Min(1), Constraint::Length(1)]).areas(inner);
    let tab = |on: bool, s: &'static str| {
        if on {
            Span::styled(s, Style::new().fg(Color::Black).bg(ACCENT).bold())
        } else {
            Span::styled(s, Style::new().fg(DIM))
        }
    };
    f.render_widget(
        Paragraph::new(Line::from(vec![
            tab(!file_mode, " Text einfügen "),
            Span::raw("  "),
            tab(file_mode, " Datei laden "),
            Span::styled("   (Tab wechselt)", Style::new().fg(DIM)),
        ])),
        tabs,
    );
    f.render_widget(
        Paragraph::new(vec![
            Line::styled(
                "Export aus „Eigene Listen“ (JSON), alte Wortliste, JSON-Liste oder eine pro Zeile.",
                Style::new().fg(Color::Gray),
            ),
            Line::styled(
                "Wörter als „Wort: verboten, verboten“. Zeilen mit # zählen nicht. Ziel wählst du in der Vorschau.",
                Style::new().fg(Color::Gray),
            ),
        ])
        .wrap(Wrap { trim: false }),
        help,
    );
    if file_mode {
        f.render_widget(Paragraph::new(Line::styled("Pfad (~/ geht):", Style::new().fg(Color::Gray))), Rect { height: 1, ..body });
        draw_field(f, Rect { y: body.y + 1, height: 1, ..body }, path, true);
    } else {
        let h = body.height as usize;
        let start = lines.len().saturating_sub(h);
        let shown: Vec<Line> = lines[start..].iter().map(|l| Line::raw(l.to_string())).collect();
        let last_w = Span::raw(lines.last().copied().unwrap_or("")).width() as u16;
        let n = shown.len() as u16;
        f.render_widget(Paragraph::new(shown).style(Style::new().bg(Color::Indexed(234))), body);
        f.set_cursor_position(Position::new((body.x + last_w).min(body.right().saturating_sub(1)), body.y + n.saturating_sub(1)));
        if lines.len() <= 1 && lines.first().is_none_or(|l| l.is_empty()) {
            f.render_widget(Paragraph::new(Line::styled("Hier einfügen (Strg+Umschalt+V) oder tippen …", Style::new().fg(DIM))), body);
        }
    }
    if let Some(e) = error {
        f.render_widget(Paragraph::new(Line::styled(format!("⚠ {e}"), Style::new().fg(BAD))), err);
    }
}

fn draw_preview(f: &mut Frame, p: &mut Preview) {
    let area = pct(f.area(), 90, 85);
    f.render_widget(Clear, area);
    let block = popup("Import-Vorschau");
    let inner = block.inner(area);
    f.render_widget(block, area);
    let [head, table_area, err] = Layout::vertical([Constraint::Length(2), Constraint::Min(1), Constraint::Length(1)]).areas(inner);
    let (new, dup, bad) = p.counts();
    let mut l1 =
        vec![Span::raw("Ziel: "), Span::styled(format!(" ◀ {} ▶ ", p.target.title()), Style::new().fg(Color::Black).bg(ACCENT).bold())];
    l1.push(Span::styled(
        match p.kind_fixed {
            Some(k) => format!("  (Export für {}; ←/→ wählt die Liste)", k.label()),
            None => "  (←/→ wählt die Liste)".into(),
        },
        Style::new().fg(DIM),
    ));
    let mut l2 = vec![
        Span::styled(format!("{new} neu"), Style::new().fg(GOOD)),
        Span::raw(" · "),
        Span::styled(format!("{dup} doppelt"), Style::new().fg(DUP)),
        Span::raw(" · "),
        Span::styled(format!("{bad} ungültig"), Style::new().fg(BAD)),
        Span::styled("  – übernommen werden nur die neuen", Style::new().fg(DIM)),
    ];
    if let Some(name) = &p.parsed.name {
        l2.push(Span::styled(format!(" · Liste „{name}“"), Style::new().fg(DIM)));
    }
    if p.parsed.skipped > 0 {
        l2.push(Span::styled(format!(" · {} unlesbar übersprungen", p.parsed.skipped), Style::new().fg(DIM)));
    }
    f.render_widget(Paragraph::new(vec![Line::from(l1), Line::from(l2)]), head);
    let words = p.target.kind() == Kind::Words;
    let rows: Vec<Row> = p
        .parsed
        .items
        .iter()
        .zip(&p.status)
        .map(|(e, s)| {
            let (label, color, why) = match s {
                Status::New => ("neu", GOOD, String::new()),
                Status::Dup(m) => ("doppelt", DUP, m.clone()),
                Status::Invalid(m) => ("ungültig", BAD, m.clone()),
            };
            let mut cells = vec![Cell::from(label).style(Style::new().fg(color)), Cell::from(e.text.clone())];
            if words {
                cells.push(Cell::from(e.taboo_joined()).style(Style::new().fg(Color::Gray)));
            }
            cells.push(Cell::from(why).style(Style::new().fg(color)));
            Row::new(cells)
        })
        .collect();
    let why = p
        .status
        .iter()
        .map(|s| match s {
            Status::New => 0,
            Status::Dup(m) | Status::Invalid(m) => m.chars().count(),
        })
        .max()
        .unwrap_or(0)
        .clamp(5, 48) as u16;
    let (widths, header) = if words {
        (
            vec![Constraint::Length(9), Constraint::Length(22), Constraint::Fill(1), Constraint::Length(why)],
            vec!["Status", "Begriff", "Verbotene Wörter", "Grund"],
        )
    } else {
        (vec![Constraint::Length(9), Constraint::Fill(1), Constraint::Length(why)], vec!["Status", "Eintrag", "Grund"])
    };
    let table = Table::new(rows, widths)
        .header(Row::new(header).style(Style::new().fg(DIM).bold()))
        .row_highlight_style(Style::new().add_modifier(Modifier::REVERSED));
    f.render_stateful_widget(table, table_area, &mut p.table);
    let msg = match &p.error {
        Some(e) => Line::styled(format!("⚠ {e}"), Style::new().fg(BAD)),
        None => {
            Line::styled(format!("Enter/j: {new} neue nach {} übernehmen · Esc: zurück", p.target.title()), Style::new().fg(Color::Gray))
        }
    };
    f.render_widget(Paragraph::new(msg), err);
}

fn draw_push(f: &mut Frame, app: &App) {
    let Modal::Push(p) = &app.modal else { return };
    let area = pct(f.area(), 92, 88);
    f.render_widget(Clear, area);
    let block = popup(if p.stage == PushStage::Merge { "Zusammenführen mit origin/main" } else { "Pushen" });
    let inner = block.inner(area);
    f.render_widget(block, area);
    if p.stage == PushStage::Merge {
        draw_merge(f, p, inner);
        return;
    }
    let [log_area, ask] = Layout::vertical([Constraint::Min(1), Constraint::Length(3)]).areas(inner);
    let width = log_area.width.max(10) as usize;
    let mut lines: Vec<Line> = Vec::new();
    for l in &p.log.lines {
        let (prefix, style) = match l.kind {
            LogKind::Step => ("── ", Style::new().fg(ACCENT).bold()),
            LogKind::Cmd => ("", Style::new().fg(Color::Magenta)),
            LogKind::Out => ("  ", Style::new().fg(Color::Gray)),
            LogKind::Err => ("  ", Style::new().fg(BAD)),
            LogKind::Ok => ("  ", Style::new().fg(GOOD)),
            LogKind::Warn => ("  ", Style::new().fg(DUP)),
        };
        for (i, part) in wrap(&l.text, width - prefix.chars().count()).into_iter().enumerate() {
            let pre = if i == 0 { prefix.to_string() } else { " ".repeat(prefix.chars().count()) };
            lines.push(Line::styled(format!("{pre}{part}"), style));
        }
    }
    let h = log_area.height as usize;
    let max_scroll = lines.len().saturating_sub(h);
    let start = max_scroll.saturating_sub(p.scroll.min(max_scroll));
    f.render_widget(Paragraph::new(lines[start..].to_vec()), log_area);
    let q = match &p.stage {
        PushStage::AskStart(s) | PushStage::AskPush(s) => Line::styled(s.clone(), Style::new().fg(DUP).bold()),
        PushStage::AskPassword => {
            let err = p.pw_error.as_deref().map(|e| format!("  ⚠ {e}")).unwrap_or_default();
            Line::from(vec![
                Span::styled("Neues Stapel-Passwort: ", Style::new().fg(DUP).bold()),
                Span::raw("•".repeat(p.password.len())),
                Span::styled(err, Style::new().fg(BAD)),
            ])
        }
        PushStage::Merge => Line::raw(""),
        PushStage::Run(_) => Line::styled("läuft … (bitte warten)", Style::new().fg(ACCENT)),
        PushStage::Done(true) => Line::styled("Fertig. Enter/Esc schließt.", Style::new().fg(GOOD).bold()),
        PushStage::Done(false) => Line::styled("Nicht gepusht. Enter/Esc schließt.", Style::new().fg(BAD).bold()),
    };
    f.render_widget(
        Paragraph::new(q)
            .wrap(Wrap { trim: true })
            .block(Block::new().borders(ratatui::widgets::Borders::TOP).border_style(Style::new().fg(DIM))),
        ask,
    );
}

/// One version of a conflicting entry, as lines: where it is and what it says.
pub fn describe(state: &State, missing: &str) -> Vec<String> {
    match state {
        None => vec![missing.to_string()],
        Some(p) => p
            .iter()
            .map(|(l, e)| {
                if l.kind() == Kind::Words {
                    format!("{}: {} — {}", l.title(), e.text, e.taboo_joined())
                } else {
                    format!("{}: {}", l.title(), e.text)
                }
            })
            .collect(),
    }
}

fn draw_merge(f: &mut Frame, p: &Push, area: Rect) {
    let Some(m) = &p.merge else { return };
    let [head, table_area, note] = Layout::vertical([Constraint::Length(3), Constraint::Min(1), Constraint::Length(1)]).areas(area);
    let n = m.conflicts.len();
    let summary = format!("von dir: {}, vom anderen: {}, Konflikte: {n}", m.mine_changes.short(), m.theirs_changes.short());
    let help = if n == 0 {
        "Keine Konflikte: Enter übernimmt beide Seiten und macht weiter, Esc bricht ab.".to_string()
    } else {
        format!("Je Konflikt eine Version wählen: ← / m = deine, → / t = andere. Offen: {}.", m.unresolved())
    };
    f.render_widget(
        Paragraph::new(vec![
            Line::styled("Auf origin/main hat jemand anderes inzwischen die Stapel geändert.", Style::new().fg(Color::Gray)),
            Line::styled(summary, Style::new().bold()),
            Line::styled(help, Style::new().fg(Color::Gray)),
        ]),
        head,
    );
    let w0 = 22u16.min(table_area.width / 4);
    let rest = table_area.width.saturating_sub(w0 + 3) / 3;
    let rows: Vec<Row> = m
        .conflicts
        .iter()
        .map(|c| {
            let cell = |lines: Vec<String>, width: u16| lines.iter().flat_map(|l| wrap(l, width.max(4) as usize)).collect::<Vec<_>>();
            let first = cell(vec![c.title(), format!("({})", c.reason.label())], w0);
            let base = cell(describe(&c.base, "(gab es nicht)"), rest);
            let mark = |side: Choice, lines: Vec<String>| {
                let chosen = c.choice == Some(side);
                let mut lines = lines;
                if chosen {
                    lines[0] = format!("✓ {}", lines[0]);
                }
                let style = match c.choice {
                    Some(_) if chosen => Style::new().fg(GOOD).bold(),
                    Some(_) => Style::new().fg(DIM),
                    None => Style::new(),
                };
                (lines, style)
            };
            let (mine, ms) = mark(Choice::Mine, cell(describe(&c.mine, "(gelöscht)"), rest.saturating_sub(2)));
            let (theirs, ts) = mark(Choice::Theirs, cell(describe(&c.theirs, "(gelöscht)"), rest.saturating_sub(2)));
            let h = [first.len(), base.len(), mine.len(), theirs.len()].into_iter().max().unwrap_or(1) as u16;
            let text = |l: Vec<String>| ratatui::text::Text::from(l.into_iter().map(Line::from).collect::<Vec<_>>());
            Row::new(vec![
                Cell::from(text(first)),
                Cell::from(text(base)).style(Style::new().fg(Color::Gray)),
                Cell::from(text(mine)).style(ms),
                Cell::from(text(theirs)).style(ts),
            ])
            .height(h + 1)
        })
        .collect();
    let table = Table::new(rows, [Constraint::Length(w0), Constraint::Length(rest), Constraint::Length(rest), Constraint::Length(rest)])
        .header(Row::new(["Konflikt", "Vorher", "Deine Version (←)", "Andere Version (→)"]).style(Style::new().fg(DIM).bold()))
        .row_highlight_style(Style::new().add_modifier(Modifier::REVERSED))
        .column_spacing(1);
    let mut state = ratatui::widgets::TableState::default().with_selected(if n == 0 { None } else { Some(p.sel.min(n - 1)) });
    f.render_stateful_widget(table, table_area, &mut state);
    if let Some(msg) = &p.merge_note {
        f.render_widget(Paragraph::new(Line::styled(format!("⚠ {msg}"), Style::new().fg(BAD))), note);
    }
}

fn draw_unlock(f: &mut Frame, u: &Unlock, area: Rect) {
    let w = 76u16.min(area.width);
    let inner_w = w.saturating_sub(2) as usize;
    let mut lines: Vec<Line> =
        vec![Line::styled(format!("Passwort für {VAULT}:"), Style::new().fg(Color::Gray)), Line::raw(""), Line::raw("")];
    let push_wrapped = |lines: &mut Vec<Line>, text: &str, style: Style| {
        for l in wrap(text, inner_w.max(10)) {
            lines.push(Line::styled(l, style));
        }
    };
    if u.checking {
        push_wrapped(&mut lines, "Prüfe … (das dauert absichtlich etwas)", Style::new().fg(ACCENT));
    } else if let Some(e) = &u.error {
        push_wrapped(&mut lines, &format!("⚠ {e}"), Style::new().fg(BAD));
    } else {
        lines.push(Line::raw(""));
    }
    if let Some(n) = &u.note {
        push_wrapped(&mut lines, n, Style::new().fg(DUP));
    }
    lines.push(Line::raw(""));
    push_wrapped(
        &mut lines,
        "Das Passwort bleibt nur im Speicher. Ohne Nachfrage: dieselbe Passwortdatei wie npm run seal (UKHDK_DECK_PASS_FILE oder ~/.config/ukhdk/deck-pass).",
        Style::new().fg(DIM),
    );
    let h = lines.len() as u16 + 2;
    let popup_area = centered(area, w, h);
    f.render_widget(Clear, popup_area);
    let block = popup("Stapel entsperren · uKnowHeDoesntKnow Listen");
    let inner = block.inner(popup_area);
    f.render_widget(block, popup_area);
    f.render_widget(Paragraph::new(lines), inner);
    if inner.height > 2 {
        let field = Rect::new(inner.x, inner.y + 1, inner.width, 1);
        let dots = "•".repeat(u.input.len().min(inner.width.saturating_sub(1) as usize));
        f.render_widget(Paragraph::new(dots.clone()).style(Style::new().bg(Color::Indexed(236)).fg(Color::White)), field);
        f.set_cursor_position(Position::new(field.x + dots.chars().count() as u16, field.y));
    }
}

/// Word wrap by display width; words longer than a line are cut.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let w = |s: &str| Span::raw(s.to_string()).width();
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in text.split(' ') {
        let mut word = word.to_string();
        loop {
            let sep = usize::from(!cur.is_empty());
            if w(&cur) + sep + w(&word) <= width {
                if sep == 1 {
                    cur.push(' ');
                }
                cur.push_str(&word);
                break;
            }
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
                continue;
            }
            // A single word wider than the line.
            let mut head = String::new();
            for c in word.chars() {
                if w(&head) + w(&c.to_string()) > width {
                    break;
                }
                head.push(c);
            }
            word = word[head.len()..].to_string();
            out.push(head);
            if word.is_empty() {
                break;
            }
        }
    }
    if !cur.is_empty() || out.is_empty() {
        out.push(cur);
    }
    out
}

fn draw_help(f: &mut Frame) {
    let rows: &[(&str, &str)] = &[
        ("↑↓ Bild↑↓ Pos1 Ende", "Eintrag oder Liste wählen"),
        ("Tab ← →", "zwischen Listen und Einträgen wechseln"),
        ("1 … 9", "Liste direkt wählen"),
        ("Maus", "klicken wählt, Rad blättert"),
        ("/", "suchen (auch in verbotenen Wörtern), Esc löscht"),
        ("a", "neuer Eintrag in der aktuellen Liste"),
        ("Enter  e", "Eintrag bearbeiten"),
        ("d  Entf", "Eintrag löschen (fragt j/n)"),
        ("m", "in die andere Liste derselben Art (Normal ↔ NSFW)"),
        ("u  Strg+Z", "letzte nicht versiegelte Änderung zurück"),
        ("i", "importieren: einfügen oder Datei, mit Vorschau"),
        ("Einfügen", "Text einfügen öffnet direkt den Import"),
        ("s", "versiegeln nach src/words/vault.json, kein Commit (j/n)"),
        ("p", "mit origin abgleichen, zusammenführen, pushen (fragt 2×)"),
        ("x", "Klartext-Backup nach private/content/ (j/n)"),
        ("r", "neu laden aus vault.json"),
        ("q  Strg+C", "beenden (warnt bei nicht Versiegeltem)"),
    ];
    let area = centered(f.area(), 86, rows.len() as u16 + 6);
    f.render_widget(Clear, area);
    let mut lines: Vec<Line> = rows
        .iter()
        .map(|(k, v)| Line::from(vec![Span::styled(format!("{k:<21}"), Style::new().fg(ACCENT).bold()), Span::raw(*v)]))
        .collect();
    lines.push(Line::raw(""));
    lines.push(Line::styled("Rot: ungültig · Gelb: doppelt · ●: geändert, nicht versiegelt", Style::new().fg(Color::Gray)));
    lines.push(Line::styled(
        "Passwort und Klartext bleiben im Speicher; auf die Platte kommt nur der Tresor.",
        Style::new().fg(Color::Gray),
    ));
    f.render_widget(Paragraph::new(lines).block(popup("Hilfe · uKnowHeDoesntKnow Listen")), area);
}
