# Minigames: Zeig drauf, Ahnungslos, Stadt, Land, Fluss

Three of the six minigames, documented together because "Zeig drauf" and "Ahnungslos" share the head-gaze pick, and "Stadt, Land, Fluss" shares the commit/reveal idea with "Gleich gedacht". The generic game skeleton (`logic.ts` Host, `game.ts` network wrapper, `ui.ts`, `bots.ts`, the `Minigame`/`PlayableGame` interfaces, undo, host election, absent/drop handling) is described in [minigame-framework.md](minigame-framework.md) and is not repeated here. Orientation for the whole codebase: [../architecture/overview.md](../architecture/overview.md). Vocabulary (Schaffner, Host, seat): [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md).

All three follow the same file pattern under `src/game/<name>/`: a pure host state machine in `logic.ts`, a network wrapper in `game.ts`, `ui.ts` and `bots.ts`. All numbers come from `src/config.ts` (`ZEIG`, `AHNUNG`, `SLF`, `GAZE`); do not hard-code them. Player-facing rules (German) are in the README sections of the same names.

## Common to all three

- **Host authority.** Rules, timers and points run only in the host's `ZeigHost` / `AhnHost` / `SlfHost` (`src/game/zeig/logic.ts:ZeigHost`, `src/game/ahnungslos/logic.ts:AhnHost`, `src/game/slf/logic.ts:SlfHost`). Clients send *intents* (`parseIntent` in each `logic.ts`; messages `zd:intent`, `ah:intent`, `sl:intent`) and render the host's broadcast state (`zd:state`, `ah:state`, `sl:state`). Every `game.ts` accepts a state message only when `from === this.net.hostId()`.
- **State is re-broadcast at least every 3 s** (`now - this.lastPublish > 3000` in each `tick`), so a client that missed a message re-syncs. **Why:** the transport is P2P with no delivery guarantee; a heartbeat is cheaper than acknowledgements.
- **Broadcast state is shape-checked, not trusted for content.** `parseState` in each `game.ts` validates types and lengths; free text (clues, guesses, answers) is cleaned again. **Why:** the host is trusted for *decisions* (private rooms among friends), but a malformed message must not break a client's UI.
- **Seat order.** `start()` sorts `net.members()` with `src/game/tableOrder.ts:byTableOrder` to build `players`; turn order (Ahnungslos) and all lists follow it. It is the table order: counter-clockwise from above, starting top right ([Minigame framework](minigame-framework.md), "Rounds"). Reconnect helpers (`tabStore`, `Recovery`) are described there too.
- **Rejoin after reload.** A reloaded browser gets a new session id; `src/main.ts` calls `game.rejoin(oldId, newId)` on every game (`src/main.ts:386`), which calls `ZeigHost.replace` / `AhnHost.replace` / `SlfHost.replace`. Every field naming the old id (players, locks, picks, scores, history, undo snapshots) is renamed so the player keeps place and points. Only the host's instance does this.
- **Leaving for good.** After `*.absentLeaveS` (30 min), or when someone asks the host to `drop(id)` and the host confirms the player is really gone (`dropNow`, waits up to `NET.dropWaitMs`), `removePlayer` takes them out, **clears the undo history** (an undo would resurrect a player who left) and ends the round if too few remain. Absent players never block a phase: every "everyone has locked / pressed Weiter" test is against `here()`, the players currently in the room.
- **Host takeover.** When the host leaves, the new host's `tick` sees `!this.host && this.isHost && this.state` and builds a host from the last public state with `fromState`. What each game can recover differs sharply, see per game below. `if (this.host && !this.isHost) this.host = null` handles the opposite case (a network split resolved in favour of another host).
- **Schaffner fines** (`penalize`) are accepted per game only in certain phases and survive undo (`keepFines`).
- **Bots** (`bots.ts`, solo test rounds only) are extra `*Game` instances on a `LocalGameRoom` and go through the same intents; they are not a separate rules path.

## Head-gaze picking (shared by Zeig drauf and Ahnungslos)

`src/game/gaze.ts` is the only place that knows about looking.

- `gazePick` returns the target whose direction has the smallest angle to the camera direction, if within `GAZE.maxAngleDeg` (18). The current pick gets `GAZE.stickDeg` (3) extra degrees so it does not flicker between two close heads. **Why:** heads at a table are close together; without hysteresis the pick would jump while the player holds still.
- `Gaze` (scene side) reads camera and head positions at call time, never caches them. **Why:** the world is rebuilt on a map change.
- `PickState` is the per-client pick: `id`, `locked`, and what was already sent. `flush` sends only changes, throttled to `GAZE.sendMs` (120 ms) unless locking (sent immediately). `reset(key)` starts over for a new question or vote; `forget()` makes the next `flush` re-send everything. **Why:** `forget()` is the takeover hook, see Zeig drauf below.
- A game opts in by implementing `GazeTarget` (`pickable()`, `aim(id)`, `lockedPick`); `main.ts` feeds it each frame. `pickable()` is empty unless the game is in its picking phase, you are a player and not yet locked; it excludes yourself and anyone not in the room.
- Without mouse-look a player can click a name: `lock(id)` takes an explicit id.
- **Picks are hidden from the table, not from the network.** The pick travels to the host as an `aim` intent (`{ a: 'aim', id, lock }`) and lives host-side in `aims`; the *public* state only says *who locked* (`locked: string[]`), never whom. They become public at the reveal. **Why:** hiding picks until the reveal is a fairness rule of the game, not a security boundary: heads are broadcast anyway, so looking is public to anyone who wants to cheat with a modified client.

## Zeig drauf

"Wer würde am ehesten …?" Everyone points at the same time. Minimum `ZEIG.minPlayers` = 3. **Why:** with two players each can only pick the other, so there is never a majority.

### Phases and flow (`src/game/zeig/logic.ts:ZeigState`)

`look` → `reveal` → (next question: `look`) … → `done`.

1. `ZeigGame.start` draws `ZEIG.questions` (8) questions with `drawQuestions` from `questionPool(room.decks(), …, room.custom?.())`; questions already asked this session are avoided (`asked`) until the pool runs low.
2. `look`: `ZEIG.lookS` (10 s). Whom you look at when time runs out is your pick; Enter/Space (or a click) locks earlier. The phase ends when time is up or every present player has locked (`ZeigHost.step`).
3. `reveal`: `ZeigHost.reveal` builds a `ZeigRecord` (`picks`, `top`, `count`) and appends it to `history`. It lasts `ZEIG.revealS` (8 s) or until everyone pressed "Weiter" (`ready`).
4. After the last question (`qNo >= questions.length`) → `done`. The host's `end` intent finishes early (`isHost` only).

### Scoring (`tally`, `ZeigHost.reveal`)

- `tally` counts picks per target, ignoring self-picks and unknown ids, and returns the most picked (all of them on a tie) plus the count.
- Everyone whose pick is in `top` gets `ZEIG.majorityPoints` (1), **but only if** `count >= ZEIG.minAgree` (2). **Why:** a "majority" of one vote (everyone picked someone different) is not agreement; otherwise every question would pay everybody.
- A pick of `null` (abstained, absent, never aimed) counts for nothing and scores nothing.
- `src/game/ahnungslos/logic.ts` imports `tally` and `Picks` from here: change them together.

### Host-authority specifics

- The host learns picks only through `aim` intents. `ZeigHost.intent` ignores an aim outside `look`, from a sender who already locked, for yourself, or for a non-player. A locked pick cannot be changed.
- `ZeigRecord.picks` is public from the reveal on (the table sees who pointed at whom); `questions` are public from the start. **Why:** neither is a secret worth guarding (comment on `questions` in `ZeigState`).
- `undo` (host's "Zug zurück") returns to *looking* at the question just revealed: picks, locks and `ready` cleared, fresh timer, points revoked. `state.undo` is part of the client's pick-reset key (`${round}|${qNo}|${undo}`), so the repeated question starts with no pick. Moving on to the next question is not a decision of its own. `penalize` is accepted in any phase except `done`.

### Private per-player state

`PickState` on each client plus `aims` on the host. No private channel is used. The client's own pick is also kept in `tabStore('zeig')` under `pick` `{k, id}` (`k` = `round|qNo|undo`, `id` the picked player or null): written when I lock, restored when the host's state says I am locked, cleared at `done`.

### Rejoin and takeover

- **Rejoin** (`ZeigHost.replace`): the picks in `aims`, locks, `ready`, history picks/tops and scores follow the new id. A reloaded client has an empty `PickState`; `ZeigGame.applyState` re-marks `locked` if the host still lists the player, and the stored `pick` (see above) is restored for the same question, so the pick is highlighted again. If nothing is stored (storage blocked), the UI shows "locked" without a highlight, which is cosmetic only: the host still holds the real pick.
- **Host takeover** is the cleanest recovery of the three (`ZeigHost.fromState`): in `look`, `locked` is cleared and the deadline becomes `max(old, now + ZEIG.takeoverS)` (3 s). `ZeigGame.tick` calls `pick.forget()`, and `flush` runs every tick while in `look`, so every client re-sends its pick and lock to the new host. **Why:** picks lived only on the old host, but every client still has its own `PickState`; if everyone re-sends and the countdown waits for them, nothing is lost. In `reveal`/`done` the public state already holds everything.
- Bots (`src/game/zeig/bots.ts:botPick`): no heads to look with, so they pick directly (lock after 2 to 7 s, "Weiter" after the reveal), leaning with probability `STICKY` (0.35) towards whoever topped most questions so far, so solo rounds produce majorities.

## Ahnungslos

Everyone knows the same word but one person, who only learns "Du bist ahnungslos". Clues go round the table, then everybody points at the suspect. Room size is 3 to 4: `AHNUNG.minPlayers` = 3, upper bound `NET.maxPlayers` = 4 (the table has four seats).

### Phases (`src/game/ahnungslos/logic.ts:AhnState`)

`clues` → `vote` → (`guess`) → `done`.

1. `AhnungGame.start` draws the clueless player first (uniformly), then the starting seat, then the word card (`drawCard`) *excluding cards the clueless player submitted themselves* (`room.pidOf`). **Why:** a word from your own custom list would give away that you wrote it. (`AhnHost.create` does the same two uniform draws for tests.)
2. `clues`: `turnOrder` = seat order from the random start, `AHNUNG.laps` (2) times round. Each clue is one word, at most `AHNUNG.maxClueLen` (24) characters (`cleanClue`). Time per turn `AHNUNG.clueS` (30 s), then `AhnHost.pass` records `word: null`. A player who is away on their turn is passed after `AHNUNG.absentPassS` (8 s).
3. `givesAway(clue, word)` refuses a clue that is the word or contains it (word length at least 3). **Only players who know the word are held to it** (`from !== secret.clueless`). **Why:** refusing the clueless player's clue would tell them they hit the word. The client mirrors the check in `AhnungGame.clue` (returns `'word'`) only when it holds a word, so the clueless client cannot probe.
4. `vote`: `AHNUNG.voteS` (15 s) head-gaze pick (`aim` intents, same mechanism as Zeig drauf). `AhnHost.closeVote` uses `tally`; `accused` is set only if exactly one person has the most votes, so a tie accuses nobody.
5. Accused is the clueless one → `guess` (`AHNUNG.guessS` 20 s, `maxGuessLen` 40; only the clueless player may send `guess`). Otherwise they escape.
6. `done`: `word` and `clueless` become public.

### Scoring

- Not caught (wrong person or tie): the clueless player gets `AHNUNG.escapePoints` (3).
- Caught and guess matches (`matches` from `src/game/gleich/logic.ts`): the clueless player gets `guessPoints` (2).
- Caught and guess wrong or timed out: every *other* player gets `catchPoints` (1).
- `Outcome = 'escaped' | 'guessed' | 'caught' | 'aborted'`; aborted rounds score nothing (`AbortReason`: `ended`, `host`, `gone`, `few`).

### Host-authority specifics and secrecy

- **The secret** is `AhnHost.secret` (`word`, `taboo`, `clueless`). The public `AhnState` carries `clueless` only after a catch and `word` only at the end. `AhnungGame.tell(id)` sends each player their part privately as `ah:secret` (`{round, word|null, taboo}`); the host's own part is set locally.
- **Honest-host limit:** the host's code holds the secret, including when the host is the clueless player; its UI simply never shows it. **Why:** there is no cheap way around this without a dealer outside the room (header comment of `logic.ts`; the README says the same).
- `ah:secret` is accepted only from the host, and `told.round` must equal `state.round` (`toldNow`), so a stale secret from a previous round is ignored.
- `AhnHost.intent` refuses everything except the host's `end` while `secret` is null (new host).
- `undo` returns to the last vote or guess with a fresh timer; word and clueless stay. `canUndo` additionally needs `secret`. Whatever an end screen revealed cannot be un-told. Clues are not decisions.
- `penalize` (Schaffner) only while `phase === 'clues'`. **Why:** talking is what the Schaffner polices, and only during the clue laps does talking matter.

### Private per-player state

`AhnungGame.told` (`round`, `word`, `taboo`) behind `myWord`, `iAmClueless`, `knowsRole`. `taboo` (the card's forbidden words) is only used for bot clue ideas. Plus a hidden copy of the host's secret, `AhnungGame.backup` (`round`, `word`, `taboo`, `clueless`): no UI reads it, it exists only for host takeover (see below).

### Rejoin and takeover

- **Rejoin:** `AhnungGame.rejoin` renames everything (`AhnHost.replace`, including `secret.clueless`), publishes, then `tell(newId)` re-sends the role. A client that lost its role by any means (reload, dropped message) asks again: in `tick`, if the round is running, I am a player, not the host and `!knowsRole`, it sends `ah:need` with the round number every `AHNUNG.askAgainMs` (2000); the host answers with `tell(from)` only if the number equals `state.round`. **Why:** a reload loses `told` (memory only), and a lost private message is otherwise unrecoverable; a poll is simpler than reliable delivery.
- **Host loss continues the round.** While a round runs, the host broadcasts a hidden `ah:backup {round, word, taboo, clueless}` right after every `ah:state` (not once the phase is `done`). A receiver accepts it only from `hostId`, checks it with `parseBackup` and keeps it in `backup` (cleared at `done`). On takeover `AhnHost.fromState(state, backup)` uses it when `backup.round` equals `state.round` and `clueless` is a player, so the round goes on with the same word and clueless player and nobody loses points. Only without a valid copy (this browser never got one, or it is stale) does it abort with `finish('aborted', 'host')`. The returning old host gets their role back through the normal rejoin (`tell(newId)` / `ah:need`). Scores from earlier rounds are kept. **Why:** aborting threw away a round whenever the host reloaded or dropped. *Accepted trade-off:* every browser holds the word and who is clueless in memory, so someone with devtools can read it; no UI shows it and this is a game among friends, see "Secret game data may be replicated" in [Minigame framework](minigame-framework.md).
- The clueless player leaving for good (`AhnHost.removePlayer`) → `finish('aborted', 'gone')`; fewer than `minPlayers` → `'few'`. When someone else leaves, their remaining turns are dropped from `seq` and the index keeps pointing at the same turn.

## Stadt, Land, Fluss

One letter, a few categories, everybody writes (or finds pictures); then the table rates category by category. Minimum 2 players (`SlfGame.start` returns if `order.length < 2`). Mode is `SlfMode = 'text' | 'bild'`, read from `room.mode()` when the round starts.

### Setup

- Letter: `drawLetter` from `SLF.letters` (no Q, X, Y), avoiding letters used this session (`letters` is cleared when 3 or fewer remain). Drawn in `SlfGame.go`, when the host ends the step "Kategorien", not at `start`. **Why:** the pick step has no time limit; a letter known while picking would let everyone think ahead.
- Pool: `categoryGroups` (for the picker, grouped "Normal" / "Ersatzstapel" when locked / "NSFW" / "Eigene") and `categoryPool` (flat). The built-in list of the mode (`slf.text` or `slf.image`), the NSFW extras only with the NSFW deck, the room's own lists only with "Eigene" (`roomLists.texts('kategorien')`); `ownOnly`: a room with only "Eigene" and at least `SLF.count[mode]` own entries has only those. Entries longer than `SLF.pick.maxLen` are left out. The built-in category lists are content (`src/words/content.ts`), not code.
- Start list (`SlfGame.start`): the last round's list if the host kept it ("Für nächste Runden behalten", `state.keep`) and the mode is the same and it is within the bounds; otherwise `defaultCategories`: locked decks (`isLocked`: `content()` is the public `FALLBACK`) give **"Klassisch"** (`classicCategories`: `SLF.fixed` = Stadt, Land, Fluss, filled from the public fallback list of the mode up to `SLF.count[mode]`; text: Stadt, Land, Fluss, Name, Tier, Beruf; pictures: Stadt, Land, Fluss); unlocked decks give a random draw of `SLF.count[mode]` (6 / 3) from the whole pool (`drawCategories`), Stadt, Land, Fluss not forced; `ownOnly` draws from the own entries, locked or not. **Why Klassisch when locked:** the fallback pool is the six classics, so a draw would be the same six in another order anyway. **Why not forced any more:** the sealed text pool is small too, so forcing three of them made every unlocked round look alike; the table now chooses. The seal script still requires Stadt/Land/Fluss in the sealed text list.
- A kept list carries over only within the same mode. **Why:** picture categories are a different kind ("Fluss" as a photo is odd) and the bounds differ (10 vs 5); a picture round after a kept text round gets its own default, while `keep` stays on.

### The step "Kategorien" (phase `pick`)

Every round starts here (`SlfHost.picking`): public list in `state.categories`, `letter` `''`, no `deadline`, nothing advances by itself. `SlfGame.go` (host only, local, not an intent) draws the letter and calls `SlfHost.begin(letter, now, players)`, which needs `SLF.pick.min[mode] <= n <= SLF.pick.max[mode]` (text 4–10, pictures 2–5) and starts `write` with the usual timer.

- **Edits** (`PickEdit` in the `pick` intent): `roll` (neu würfeln: a random one from the pool that is not in the list), `set` (ersetzen, `how` `'pool'` or `'free'`), `add` (text, or `null` = a random one), `remove`, `preset` (`'klassisch'` or `'zufall'` = a new draw of `SLF.count[mode]`). The host resolves the randomness when the edit arrives (`SlfHost.resolve`, using `SlfHost.pool` and `rng`, which `SlfGame.wire` sets from the room's decks and own lists), so what is stored is a concrete `Edit` (`set` with `how: 'roll'`, `add`, `remove`, `preset` with its `list`). **Why resolve on arrival:** a proposal shows the host exactly what accepting it would do ("„Beruf“ → „Farbe“ (gewürfelt)").
- **`applyEdit(list, edit, mode)`** is the one rule: the target must be in the list, a new text must not be (case and spaces aside, `normWord`), `add` only below the max, `remove` only above the min, a preset only within the bounds and only if it changes something.
- **Host vs. everybody else.** The host's own edits apply at once (`SlfHost.change`). Anybody else's become a `Proposal` `{id, by, edit}` in `state.proposals` (public, so all see who proposed what as pending). The host `accept`s (applies it; refused while it would break the bounds, then it waits) or `reject`s; the author may `withdraw`. Members who joined after the start may propose too (`present`), and `go` takes them into the round (`SlfGame.go` adds members not yet in `players`, sorted by table order).
- **Limits.** At most `SLF.pick.maxProposals` (3) open proposals per player; a proposal equal to an open one (`editKey`: same target and text, any roll of the same category, the same preset) is dropped, from whoever; one that would not apply now is refused. After every applied change, proposals that can never apply again are pruned (`staleEdit`: their category is gone or their new text is in the list); merely out of bounds is not stale. Open proposals are dropped at `go`.
- **Validation.** `parsePickEdit` / `parseIntent` clean every text with `cleanCategory` (control characters out, blanks collapsed, at most `SLF.pick.maxLen` = 40 characters, longer is refused, not cut: the sealed content allows 40) and ids with `isSeq`; clients check the host's proposals with `parseEdit` in `parseState`, which drops broken ones and refuses a letter during `pick`. Typing in the UI is limited to `SLF.pick.maxTyped` = 24 (`LISTS.maxChars.kategorien`), so a typed category also fits an own list.
- **"Für nächste Runden behalten"**: `keep` intent, host only, allowed in every phase (also on the end screen, "Kategorien behalten"). Not an undoable move. **Why on the end screen too:** you often only know after playing that the list was good.
- **"In eigene Liste übernehmen"** (UI only, `SlfUi.keepTyped`): a typed category can go into one of the player's own `kategorien` lists via `myLists.add`, or into a new list "Meine Kategorien" (`myLists.create`). Nothing is sent for it; with "Eigene" on, the list reaches the room like any other.
- **Zug zurück.** While picking, every applied change, accept and reject is a decision (`history.push` before it). Undo restores the list; a taken-back accept or reject puts that proposal back as pending, proposals that came in since stay (merged by id), `keep` stays. `begin` clears the history: **Zug zurück never leads from `write` back into `pick`.** **Why:** the letter is out and drafts are typed against the list (by index); going back would mean a new letter or a known one, re-opening locked commitments and re-keying drafts. A wrong start is fixed by ending the round; with "behalten" the list carries over. "end" during `pick` is a decision like elsewhere and can be taken back into `pick`.
- **Robustness.** Host takeover: the list, `proposals`, `seq` and `keep` are public, so `fromState` carries on with all of them (open proposals are kept, ids stay unique via `seq`). Rejoin: `replace` renames the authors of proposals. A reload shows the pick view again from the next state (nothing private in this step; a half-typed category in the editor is lost). `removePlayer` drops the leaver's proposals. Absent players block nothing: only the host's `go` advances. The Schaffner does not fine here (`writing` is false). Bots never propose; the solo round starts when the human host presses "Los geht’s".
- **Pool visibility.** Every client builds its own picker pool (`SlfGame.poolGroups`) from its deck state and `roomLists`; the host draws rolls from its own. **Why:** no extra traffic, and a client whose deck key is still on its way just sees the smaller pool; anything typed or picked is checked by the host anyway. This shows the room's own categories to everybody, unlike the other own-list kinds ([Custom lists](custom-lists.md)): categories are public as soon as a round plays them, so there is nothing to keep secret.
- UI (`SlfUi.renderPick`, `.slf-pick`, a `.wi-maker` window that frees the mouse): head with round, mode and "n · erlaubt min–max", the list in two columns (number, name, **Würfeln**, **Ersetzen**, **✕**), **+ Hinzufügen** / **+ Zufällige**, the editor (input, **Übernehmen** or **Vorschlagen**, the own-list select, the pool as buttons filtered by what is typed, grouped), "Vorschläge" (author in seat colour, the change; host: **Annehmen** / **Ablehnen**, author: **Zurückziehen**, others: "wartet auf …"), footer **Klassisch**, **Zufall**, host: **Für nächste Runden behalten** (toggle) and **Los geht’s**. Rebuilt only when what is shown changes; the editor element persists, so somebody else's change never interrupts typing. **Würfeln** and **+ Zufällige** are disabled when nothing in the local pool is left outside the list (locked, without own lists, the pool is exactly the six classics of "Klassisch"); typing still works.

### Phases (`src/game/slf/logic.ts:SlfState`)

`pick` → `write` → `lock` → `reveal` → `rate` → `done`.

0. `pick`: the step "Kategorien" above; no timer, the host starts the writing.

1. `write`: text `SLF.writeS` (180 s); pictures `SLF.imageS` (90 s, one timer for all categories). **Why:** one shared timer lets everybody hunt in their own order.
2. **"Stopp!"** (the button, `SlfGame.stop`) is allowed only once every category is filled (`filled`). It commits the player's answers (below), sends the `stop` intent and lowers the deadline to `min(deadline, now + stopS)`: `SLF.stopS` (10 s) in text, `SLF.imageStopS` (20 s) in pictures. **Why:** searching for a picture takes longer than typing. The first stopper is `stopBy`.
3. `lock`: entered when the deadline passes with commitments missing; `SLF.lockS` (3 s) for clients to send a commitment for whatever they have. If everyone committed during `write`, the host skips straight to `reveal`.
4. `reveal`: collecting the revealed content; `SLF.collectS` (5 s) in text, `SLF.collectImageS` (12 s) in pictures (bigger payloads), or earlier when all present players' reveals have checked out.
5. `rate`: per category, see below. After the last category → `done`.

### Commit/reveal (the anti-copying mechanism)

The README promises: "Bis dahin verlässt keine Antwort deinen Rechner" (until the writing is over, no answer leaves your machine; only a fingerprint does).

- While writing, answers live only in the client-side `SlfGame.draft` (`setText`, `setPic`, `setCaption`). Nothing is sent.
- `SlfGame.commit` makes a random salt (`newSalt`) and computes `textCommit` (one SHA-256 over all answers) or one `imageCommit` per category (`${cat}|${cap}|${img}`), via `commitOf` from `src/game/gleich/logic.ts`. Only the commitments go out (`stop` / `lock` intents) into public `state.commits`; content and salt stay in the client's private `secret`.
- **Committing is final per round** (`lockedRound`). The commit happens *before* the intent is sent: as host my own intent can immediately end the writing, and the reveal needs the secret.
- `SlfGame.sendReveals` (run on every state change and every `tick`): once the phase is `reveal` (in picture mode also `rate`/`done`) and my commitment matches my secret, send `sl:reveal` (content + salt) to each member that does not have it yet (`sentTo`). **Why re-sent from `tick`:** text lives in the public `answers` afterwards, but pictures do not (too big), so a player who joined or reloaded later still has to get them directly.
- Receivers verify with `verifyText` / `verifyImage` against `state.commits[from]` and feed the result to the host (`revealText` / `revealImage`). Anything not matching its commitment counts as nothing. `answersView()` shows an answer as empty if the *local* check disagrees with the host's.
- Pictures are keyed by their commitment (`pictures`, `picOf`), not by player id. **Why:** a rejoiner has a new id but keeps the same commitments, so verified pictures survive the id change.
- The host cannot copy either: it only knows commitments until the reveal. Verified text answers are copied into public `answers` in `SlfHost.judge`.

### Rating, text rounds

One category at a time (`cat`). Automatic: `judgeText` marks an answer invalid if it is empty or does not start with the letter (`startsWithLetter`: umlauts and accents fold, Ä counts as A; a leading article is ignored *or* kept, either counts, so "Den Haag" works); equal answers (`matches`) form `groups`. Players can **flag** an answer (`flag` intent): kind `'bad'` ("ungültig") or `'same'` ("gleich wie" another answer the matcher missed). A flag opens a vote (`SLF.voteS`, 15 s) among the *others*: authors are excluded, and with fewer than 2 eligible voters (two players) everyone votes, so nobody decides alone. Raising the flag counts as the flagger's yes. `yes > no` decides, a tie means no. A decided vote extends the category deadline to at least `SLF.afterVoteS` (6 s) from then. A category lasts `SLF.rateS` (45 s) or until everyone pressed "Weiter". Points per category (`SLF.points`): 10 for a unique valid answer, 5 for the same valid answer as someone else, 20 for the only valid answer in the category, 0 for invalid.

### Rating, picture rounds

Per category: step `vote` (`SLF.imageVoteS`, 30 s), where each player sends one `judge` intent with `ok` per other author ("zählt / zählt nicht") and a `best` pick (never their own); then `SlfHost.tallyImages` → `judgeImages` and step `show` (`SLF.showS`, 15 s, or all "Weiter"). A picture counts unless it has more "zählt nicht" than "zählt" votes (a tie counts). `SLF.imagePoints` (10) per counting picture, `SLF.bestBonus` (5) for the best one (all of them on a tie).

### Host-authority specifics

- `SlfHost.judge` builds the public `answers` (text) / `shown` (pictures: only whether a verified picture exists) once the reveals are in or the deadline passes. Single flag votes and picture judgements stay on the host (`votes`, `judges`); the public state exposes only who voted (`vote.voters`, `judged`), not how.
- `SlfHost.snap` snapshots state plus the verified reveals (`texts`, `pics`) for undo. The comment on `SlfHost.history` lists what each decision (flag vote, moving on, picture result, end) goes back to. `beforeVote` holds the state from before the open flag, so a flag vote is undone as "never raised".
- `penalize` (Schaffner) only in `write` / `lock`. **Why:** talking while others write is reading answers out, which is copying; during rating everybody sees everything anyway.

### Private per-player state

- `SlfGame.draft` (`texts`, `pics`) is mirrored into `tabStore('slf')`: `t.<round>` (the texts, written on every input), `p.<round>.<cat>` (the pictures) and `salt.<round>` (written at commit). After a reload the draft comes back; in `write` the player simply carries on, and in `lock` `SlfGame.applyState` commits the restored draft ("empty fields count as nothing" still applies if nothing was stored). Bots share the tab with the human and are built with `persist = false`, so they never touch the store.
- `SlfGame.secret` (`round`, `salt`, `commits`, `texts`, `pics`): created by `commit`. `locked` is true only if `state.commits[self]` equals `secret.commits`. After a reload `recoverSecret` rebuilds it (see below).

### Rejoin and takeover

- **Pick step:** see "The step Kategorien" above (list and proposals are public and survive both).
- **Rejoin** (`SlfHost.replace`): renames everything, but in `write`/`lock` the old commitment is **deleted** (`delete s.commits[oldId]`), because after a reload the answers behind it are gone. The player writes again (or is committed empty in `lock`). From `reveal` on, commitments are renamed and kept. A rejoiner who reloaded rebuilds the secret in `SlfGame.recoverSecret`: from the stored salt plus the restored draft, verified against my own commitment (`adopt`). Fallback if that is missing or does not verify (storage blocked): `Recovery` topic `'slf:mine'` `{round}`; peers answer from the proofs they verified (my revealed answers and salt), and the reply is only taken if it matches my commitment. Only if both fail does the content count as nothing, while text already in public `answers` stays.
- **Host takeover** (`SlfHost.fromState` + `SlfGame.feedHost`): the public state keeps phase, letter, categories, commitments, answers, results and scores. Not recoverable: an open flag vote (the flag is removed and can be raised again) and picture judgements (`judged` cleared, `voteNo` bumped so every client may vote again, timer reset to `SLF.imageVoteS`). The `lock` and `reveal` deadlines restart. In `reveal`, `feedHost` feeds the new host from the client's own `verified` / `pictures` maps, so nobody has to reveal twice. **Why:** commitments are public and content stays on the clients, so, unlike Ahnungslos, nothing the new host needs is secret.
- `SlfHost.removePlayer`: deletes the leaver's commitments and answers and any flag that names them (a vote about their answer is moot), drops their judgements, and ends the round if fewer than 2 remain.
- Bots (`src/game/slf/bots.ts:SlfBots`, `src/game/slf/botWords.ts:botAnswer`): fill their sheet at once from small shared word lists per category and letter, so they sometimes collide and the 5-point rule shows; they also flag, vote and judge pictures (`botPicture` draws letter and word on a canvas).

## Options

Everything tunable is in `src/config.ts`:

| Config | Keys that matter |
| --- | --- |
| `GAZE` | `maxAngleDeg` 18, `stickDeg` 3, `sendMs` 120 |
| `ZEIG` | `questions` 8, `lookS` 10, `revealS` 8, `majorityPoints` 1, `minAgree` 2, `minPlayers` 3, `takeoverS` 3, `absentLeaveS` 1800 |
| `AHNUNG` | `laps` 2, `clueS` 30, `voteS` 15, `guessS` 20, `escapePoints` 3, `guessPoints` 2, `catchPoints` 1, `maxClueLen` 24, `maxGuessLen` 40, `minPlayers` 3, `absentPassS` 8, `askAgainMs` 2000 |
| `SLF` | `letters`, `fixed` (preset "Klassisch"), `count` (text 6, bild 3: start list), `pick` (`min` 4 / 2, `max` 10 / 5, `maxProposals` 3, `maxLen` 40, `maxTyped` 24), `writeS` 180, `stopS` 10, `imageS` 90, `imageStopS` 20, `lockS` 3, `collectS` 5, `collectImageS` 12, `voteS` 15, `rateS` 45, `afterVoteS` 6, `imageVoteS` 30, `showS` 15, `points` (10 / 5 / 20), `imagePoints` 10, `bestBonus` 5, `maxAnswerLen` 32, `maxCaptionLen` 24 |

## Tests

`tests/zeig.test.ts`, `tests/ahnungslos.test.ts`, `tests/slf.test.ts` drive the host classes directly (pure, no network) and the `*Game` classes over a `LocalGameRoom`. The SLF network tests start a round with `begin` (`start` + `go`); the pick step has its own blocks ("the step Kategorien", pure and over the network: proposals, caps, validation, presets, locked vs. unlocked default, keep, takeover, reload, undo).

## Related links

- [minigame-framework.md](minigame-framework.md): shared skeleton, undo, host election, absent/drop
- [../architecture/overview.md](../architecture/overview.md)
- [../meta/TERMINOLOGY.md](../meta/TERMINOLOGY.md)
