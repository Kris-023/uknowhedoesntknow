# Custom lists ("Eigene Listen") — your own words, questions and categories

Players keep several named lists in their own browser. Lists that are switched on join the deck "Eigene" in a room, and the games mix them with the built-in content, without anyone seeing what the others brought.

## How it works

- **Kinds.** `src/words/lists.ts:LIST_KINDS` = `words`, `zeig`, `fragen`, `kategorien`; `lists.ts:KIND_INFO` has the labels, target games and examples. `words` = word cards with forbidden words ("Sag's anders", "Ahnungslos"); `zeig` = endings for "Wer würde am ehesten …?" ("Zeig drauf"); `fragen` = start questions ("Gleich gedacht"); `kategorien` = categories ("Stadt, Land, Fluss"). `TextKind` is every kind but `words`.
- **Data.** `lists.ts:CustomList` = `{ id, kind, name, on, items }`; `lists.ts:ListItem` = `{ id, text, taboo, by? }` (`taboo` only for words; `by` = author when taken over). `on` is the switch "Im Raum".
- **Limits.** `src/config.ts:LISTS` (table below); `src/config.ts:WORDS` holds the word-card limits. *Why:* limits keep both storage and what a peer may send small.
- **Cleaning.** `lists.ts:cleanEntry` (control characters out, blanks collapsed, per-kind length; for `zeig` it strips the frame "Wer würde (am ehesten) …" and trailing `?` or `…`, because people paste whole questions and the game adds the frame itself), `parseItem`, `parseList`, `parseLists` (valid lists only, unique ids, capped), `tidy` (dedupe via `src/words/custom.ts:normWord`: same text apart from spaces and case counts as a duplicate). `custom.ts:parseCard` validates a word card from storage, a file or a peer; anything odd is dropped, never trusted. `custom.ts:playerId` is a stable per-browser id so cards keep their author across sessions and name changes (memory-only id without storage).
- **Store.** `lists.ts:ListStore` (instance `myLists`) saves every change at once to `localStorage` key `ukhdk.lists.v1` (`{ v: 1, lists }`) and announces it via `onChange`; `version` increments on every save. API: `all`, `ofKind`, `get`, `create` (returns an error string when over the limit), `rename`, `setOn`, `remove`, `add`, `removeItem`, `has`, `adopt`, `exportList`, `importText`, `enabled(kind)` (entries of all lists that are on, deduped), `cards()` (my word cards in play; own entries carry my id), `shareable()` (what I bring into a room). Without storage everything still works for the session.
- **Legacy migration.** `lists.ts:loadLists`: with no lists yet, the single word list of earlier versions (`custom.ts:LEGACY_WORDS_KEY`, `ukhdk.words.v1`) becomes the list "Meine Wörter" (`lists.ts:MIGRATED_LIST`). *Why:* the old key is left untouched, so nothing is lost even if the new data cannot be written. Old word exports (`{ukhdkWords, cards}`) and word cards with `word` instead of `text` are read too.
- **"Übernommen".** `ListStore.adopt(kind, entry)` puts someone else's entry into my list named `lists.ts:ADOPT_LIST` ("Übernommen"), created on demand, keeping its author; it returns `false` if I already have it or a limit is hit. It is called by the "Übernehmen" action in `src/game/sagsanders/ui.ts`. Own entries carry my id, adopted ones their author's.
- **Room sharing.** `src/game/roomLists.ts:RoomLists` (created in `src/main.ts` with `myLists.shareable`, a predicate "the room plays with the deck Eigene", and `myLists.version`): `tick()` runs per frame and sends my enabled lists of all kinds as `cl:lists` to each member that does not have the current version yet (again to newcomers and rejoiners, who have new ids, and to everyone after a change), only while the room uses the deck "Eigene". Received data goes through `lists.ts:parseShared` (validated and cut to the limits). Accessors for the games: `cards()` (all word cards in the room), `texts(kind)` (deduped via `lists.ts:uniqueTexts`), `pidOf(id)`. Entries of members who left disappear with them (`sources` only counts members still here); my own are read fresh from storage. Peers from before the lists still send `sa:words`, which is understood.
  - **Never via the host, never shown.** Each client sends straight to each member, nothing goes through the host, and no UI lists what others sent. *Why:* word cards must stay unseen until played, otherwise the guessers know the answers. **Exception: `kategorien`.** The step "Kategorien" of "Stadt, Land, Fluss" lists the room's own categories in its picker for everyone ([SLF](minigames-zeig-ahnungslos-slf.md)), because a category is public anyway as soon as a round plays it.
- **Taking a typed category into a list.** In that step a player can save a category they typed into one of their own `kategorien` lists (or a new list "Meine Kategorien"), through `ListStore.add` / `create`.
  - **Fairness.** `src/words/index.ts:drawCard` skips submissions by the people who have to guess while anything else is left (the author is identified via `pidOf`).
- **Question pool.** `lists.ts:questionPool(decks, normal, nsfw, custom, need)`: built-ins by deck plus the room's own when "Eigene" is on; a room with only "Eigene" plays only its own if there are at least `need`, else the normal ones fill in; NSFW keeps the normal questions in (there are few crude ones). `src/main.ts` feeds the games via `roomLists.texts(...)` (`gleichRoom`, `zeigRoom`, `slfRoom`).
- **Import and export.** `ListStore.exportList(id)` produces JSON `{ ukhdkList: 1, kind, name, items }` (words keep the full item including forbidden words; other kinds keep `id`, `text`, `by`); `ListStore.importText(kind, text)` accepts such an export or plain text, one entry per line, words as `Wort: verboten, verboten`, merges into the list of the same name (the export's name, else "Importiert"), and throws a German message for the form ("Keine Einträge gefunden.", "Das ist keine Liste.", or that the list belongs to another kind).

## Using it

Menu, tab **Eigene Listen** (`src/ui/listsView.ts:ListsView`): sub-tabs per kind (Wörter, Zeig drauf, Startfragen, Kategorien) with a one-line explanation (`ABOUT`), then per list the toggle "Im Raum: an" / "Im Raum: aus", its entries (button "Löschen"), "Liste löschen", "Liste kopieren", "Als Datei speichern", and the section "Liste laden" (paste text or one entry per line, then "Übernehmen", or "Datei laden" for `.json` / `.txt`). The last sub-tab and open list are remembered for this page load only. The view also embeds the deck unlock box ([Built-in decks](content-decks.md)); own lists work whether the built-in decks are locked or not.

In a room the host picks the decks (room settings, "Stapel"); with "Eigene" on, every client sends its enabled lists to the others automatically.

## Options

| Config key | Default | Meaning |
| --- | --- | --- |
| `LISTS.maxLists` | 40 | lists in total, all kinds |
| `LISTS.maxNameChars` | 32 | list name length |
| `LISTS.maxItems` | 500 (`WORDS.maxCustom`) | entries per list |
| `LISTS.maxChars` | words 40, zeig 100, fragen 80, kategorien 24 | longest entry per kind (a category has to fit a board) |
| `LISTS.maxShared` | words 300, zeig 150, fragen 150, kategorien 60 | what one player may bring into a room |

## Related links

- [Built-in decks](content-decks.md)
- [Networking](networking.md) (member-to-member `GameNet` messages)
- [Menu and settings](menu-settings.md)
- [Architecture overview](../architecture/overview.md)
- [Terminology](../meta/TERMINOLOGY.md)
- Tests: `tests/lists.test.ts` (entries, migration, per-kind lists, adopt, import/export, sharing, legacy `sa:words`)
