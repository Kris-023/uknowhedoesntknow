# Wer bin ich? / Sag's anders / Gleich gedacht — three word-and-guess minigames

Three of the six minigames, all built on the contract in [minigame-framework.md](minigame-framework.md) (host-authoritative
`logic.ts` + `game.ts` + `ui.ts` + `bots.ts`). What they have in common beyond that: each hides something from someone
while still using a host that is itself a player, so the host's own copy of the secret must not leak either. The other
three games are in [minigames-zeig-ahnungslos-slf.md](minigames-zeig-ahnungslos-slf.md); terms in
[TERMINOLOGY](../meta/TERMINOLOGY.md).

Turn order in all three is the table order (counter-clockwise from above, starting top right), sorted with
`src/game/tableOrder.ts:byTableOrder`; see [Minigame framework](minigame-framework.md), "Rounds". Reload and
host-change recovery uses the shared helpers `tabStore` and `Recovery` described there.

## Wer bin ich? (`src/game/whoami/`)

### Rules and phases

- Phase `cards`: everyone makes a card (an image) for the next player in the circle (`assignAuthors`), so nobody makes
  their own. When all authors have sent (`ready`), the round goes to `play`; the first player in turn order starts.
- Phase `play`: the player on turn either asks (`ask`) a yes/no question out loud or says "Ich bin ..." and `guess`es, or
  passes. Both open a **secret vote** among everyone else (`WHOAMI.voteS`, default 20 s, room setting). The vote closes
  when all other players have voted, when all *present* ones have, or at its deadline with the votes that came in.
- `majority`: for a question, `yes`/`no`/`idk` by plurality with ties going to `idk`; a "yes" lets the asker ask again,
  anything else passes the turn. For a guess, `right` needs strictly more yes than no (a tie is wrong); a guess always
  passes the turn afterwards.
- Scoring: a right guess scores by order of solving, `WHOAMI.points = [3, 2, 1, 1]`. Solved players are skipped
  (`nextUnsolved`). The round ends (`done`) when everyone has solved, when fewer than 2 players remain, or when the host
  ends it. Per-player question counts are kept in `questions`.

### How it works

- `src/game/whoami/logic.ts:WhoamiHost` is the pure state machine; `src/game/whoami/game.ts:WhoamiGame` the glue.
  Intents are `ready | ask | guess | pass | vote | end` (`parseIntent`); `end` is host-only. Message types: `wi:state`,
  `wi:intent`, `wi:card`, `wi:rejoin`, `wi:drop`.
- **Single votes never leave the host.** `WhoamiHost` keeps `votes` privately; the public state only has
  `vote.voters` (who has voted) and, afterwards, `last.result` and the vote count. *Why:* the point is a secret ballot;
  the host is a player and could otherwise read others' votes from state. A client keeps its own choice only locally
  (`WhoamiGame.myVote`, keyed by `voteKey`, "Deine Stimme: Ja") and never sends it back.
- **Cards are peer-to-peer and never touch the host.** `src/game/whoami/game.ts:WhoamiGame.submitCard` sends
  `wi:card {target, img}` straight to every member except the author and the target, then sends the `ready` intent.
  Images are JPEG data URLs (longest side `WHOAMI.cardPx` 512, quality `cardQuality`), parsed on receipt by
  `parseCardData` and capped at `WHOAMI.cardMaxChars`. *Why:* the host is a player too; routing a card through it would
  let it (or its relay logs) see the card of whoever is the target. A receiver accepts a card from the author, or a copy
  from another player only if it holds none yet (the rejoin case).
- **Own card hidden until solved or round end.** A client drops a `wi:card` for itself unless `phase` is `done` or it is in
  `solved`. The author keeps the image in memory (`myCard`) and, in `applyState`, sends it to the target once that
  player solved or the round is over (`revealed` set). `GameEntry.board` in `main.ts` shows `'?'` for your own card until
  it is in `cards`.
- **Head cards** are HTML overlays (`src/game/whoami/cardsView.ts:CardsView`), anchored at the card's bottom edge just above
  the head via `Players.cardPos`; scale from `WHOAMI.cardSizeM`, `WHOAMI.cardY`. A card is culled when `v.z > 1 || !cardOnScreen(ax, ay, px, cardHeight(px, aspect, font), w, h)`: behind the camera, or
  its whole rectangle outside the stage (`w` x `h` from `trackSize`). The rectangle is bottom-centre anchored, its width
  is `px` (fixed, no setting), and its height is estimated from the `.card-tag` CSS (picture at the card's
  aspect plus name strip plus borders), so there is no layout read per frame. *Why:* a card grows up and sideways from
  its anchor, so a head just outside the edge can still show half a card. The name tag's step-aside follows the cull.
  Test: `tests/cardsCull.test.ts`.
- **Rejoin** (`WhoamiGame.rejoin`): `WhoamiHost.replace` renames the id across `players`, `authorOf`, `ready`, `solved`,
  `turn`, `vote`, `last`, `scores`, `questions` and the undo history; then the game broadcasts `wi:rejoin {old, new}`
  and publishes. The returner has lost every card from memory, so each client that holds cards re-sends them with
  `resendTo` (never the returner's own card, checked against both ids because the note can arrive before the renamed state).
  This push is one-shot (a lost resend is not retried); the pull below covers that.
- **Reload and missing cards** (reconnect). `tabStore('wi')` keeps `myCard {round, img}` (the card I made) and `myVote
  {key, v}`; both are cleared on a round change (`myCard` survives `done`, since the author still reveals it) and come back
  with the first state after a reload. `WhoamiGame.missingCards()` lists targets whose card should exist (author is
  `ready`; my own only once revealed). After a 1500 ms grace (`MISSING_GRACE_MS`, so the normal push can arrive first)
  the game asks everyone with `Recovery` topic `'wi:cards'` and `{have}` (the targets I hold). Any holder answers with
  one card per reply, never the asker's own unrevealed card; the asker re-asks at once after each reply until nothing is
  missing, and remembers a give-up so it does not loop. `renameCard(old, new)` re-keys cards I hold when a player
  rejoins under a new id. A `wi:card` that arrives before any state is dropped; the ask covers it.
- **Host takeover**: `tick()` builds `WhoamiHost.fromState(state)`; an open vote is cleared (its secret ballots died with
  the old host) and the guesser is on turn again; undo history is gone.
- **Absent players**: `absent()`; the host's `tick()` runs `closeIfAllIn(here)` so a vote does not wait for them; an absent
  player's turn passes after `WHOAMI.absentPassS` (8 s) when no vote is running; they are removed after `absentLeaveS`
  (30 min) or on "Ohne X weiterspielen" (`drop` → `dropNow`). `removePlayer` in phase `cards` redraws the circle
  (`assignAuthors`) and keeps the cards whose target did not change.
- **Zug zurück**: decisions are a resolved vote (snapshot taken when the vote *opened*, saved on resolve via
  `beforeVote`, so the guesser is on turn again), a pass, and a host `end`. Takes back scores and `solved` with it; fines
  stay. After an undo, `applyState` reacts to the `undo` counter: if you are no longer solved, your own card is removed
  from `cards` again and the author re-sends it when you solve it for real. What was already seen stays seen.
- **Solo bots**: `src/game/whoami/bots.ts:WhoamiBots` make a card, vote at random and ask a few questions before guessing.

Known gap, a cost of the peer-to-peer card design: in a round with only two players, if storage is blocked (or the tab was
reopened, which starts with an empty `sessionStorage`) and the *author* reloads before the target has solved, nobody else
holds that card and it is lost. With three or more players every other member holds a copy and answers `wi:cards`.

## Sag's anders (`src/game/sagsanders/`)

### Rules and phases

- A turn: the explainer gets a word card (a word plus forbidden words) and explains it without saying the word or any
  forbidden word. Phases `ready` (waiting for the explainer to press begin) → `turn` (running, `SAGS.turnS` 60 s, room
  setting) → next player's `ready`, until `turns = players * SAGS.turnsEach` (2 each) are played → `done`.
- Mode: **teams** with exactly 4 players when the room wants teams (`teamsFor`: players 0 and 2 against 1 and 3 in turn
  order, so turns alternate A, B, A, B), otherwise **free for all** (`ffa`; fewer than 4 players always).
- Teams scoring: explainer's team gets `SAGS.teamGot` (1) per guessed word; the *other* team watches the card live and can
  call a foul (`foul`), which scores `SAGS.teamFoul` (1) for them. Skipping scores nothing.
- Free for all: the explainer names who guessed it (`got` with `by`): guesser `ffaGuesser` 2, explainer `ffaExplainer` 1.
  After each card, everyone sees it for `SAGS.challengeS` (8 s) and anyone but the explainer may `challenge`: the points of
  that card are taken back and the explainer loses `ffaFoul` (1); the card becomes a foul.
- `playable()` skips a player with nobody to guess for them (a team of one).

### How it works

- `src/game/sagsanders/logic.ts:SagsHost` and `src/game/sagsanders/game.ts:SagsGame`. Intents: `begin | got | skip | foul |
  challenge | end`. Message types: `sa:state`, `sa:intent`, `sa:card`, `sa:drop`. Every card intent carries a card
  serial `no` (and the card itself); the host accepts it only when `no === state.cardNo`. *Why:* a late click on the old
  card must never hit the next card.
- **The host never needs a word before it is played.** The explainer draws locally (`SagsGame.draw` from `wordPool`/`drawCard`,
  avoiding cards already drawn this session and the guessers' own submitted cards via `pidOf`) and sends
  `sa:card {no, card}` only to the watchers (`watchersOf`: the other team; nobody in free for all). The host learns the card
  only from the result intent, and it enters the public `log` only once played. *Why:* the host may be one of the guessers; the
  word must stay off every guesser's screen and out of the shared state. A client accepts `sa:card` only from the current
  explainer and only if it is a watcher.
- **Private per-player state** is `hand` (the explainer's current card) and `seen` (the watcher's view of it, cleared when
  `cardNo` moves on). Both are memory-only; nothing goes into `tabStore`.
- **Rejoin** (`SagsGame.rejoin`): `SagsHost.replace` renames players, teams, explainer, log entries, scores and undo history,
  then publishes. An explainer who reloads draws a *new* card (`applyState` sees no `hand`), as before. A watcher who
  misses the current card (reload, or a dropped message) asks for it: after a 1500 ms grace (`CARD_GRACE_MS`) it sends
  `Recovery` topic `'sa:card'` `{no}` to `state.explainer`. The explainer answers only while its hand is that card
  (`hand.no === cardNo`, phase `turn`) and only to its listed watchers (`watchersOf`), so guessers never get it.
- **Host takeover**: `SagsHost.fromState`; history lost. The deadline carries over in the state.
- **Absent players**: `SAGS.absentPassS` (8 s): an absent explainer's turn is ended with `pass()` (in `ready` it moves to the
  next explainer); `absentLeaveS` 30 min or `drop` removes them (`removePlayer`: out of the order and their team; an empty
  team or fewer than 2 players end the round; if the explainer left, the next one takes over without counting a turn).
- **Zug zurück**: every card result (got, skip, foul, challenge), a timed-out turn, a pass and a host `end` push a snapshot.
  `SagsHost.undo` restores it, bumps `undo`, and moves `cardNo` *forward* (never back): the card that was decided is public
  in the log by now, so the explainer draws a fresh one, and late clicks on the old number are ignored. A taken-back running
  turn resumes with the time it had left then, at least `UNDO.resumeMinS` (10 s). *Why* the minimum: a card decided in the last
  second must not be over again at once.
- **Solo bots**: `src/game/sagsanders/bots.ts:SagsBots` begin, then randomly skip or get a word, and occasionally call a foul.

## Gleich gedacht (`src/game/gleich/`)

### Rules and phases

- Cooperative. Try 1: every player gets a different question (`drawQuestions`, none twice per round, avoiding questions asked
  earlier this session) and writes one word. Later tries: write a word that connects the last try's words.
- Phases: `write` (`GLEICH.writeS` 45 s; lock a word, can lock again until time is up) → `reveal` → `done`. `reveal` covers two
  steps: collecting the revealed words (`words` still `null`, window `GLEICH.collectS` 4 s) and showing the judged words
  (`GLEICH.revealS` 25 s, or until everyone present pressed "Weiter" via `ready`).
- Matching (`src/game/gleich/logic.ts:matches`): case, umlauts, accents, punctuation and a leading article are ignored
  (`normalize`); a German plural/case ending counts if the shorter word is at least 4 letters; one typo counts only in words of at
  least 5 letters (so Hund and Mund stay different). `groupsOf` chains matches (a~b, b~c puts all three together);
  `biggestGroup` takes the largest, first by seat order on a tie.
- If every *present* player (at least 2) is in the biggest group, the round is solved automatically. Otherwise anyone can
  call a "Zählt als gleich?" vote (`call`; once per try, `GLEICH.voteS` 15 s, simple majority of yes over no, ties and silence
  do not solve). A lost vote gives at least `GLEICH.afterVoteS` (8 s) of reading time before the next try.
- Scoring: everyone in the round gets `GLEICH.points[tryNo - 1]` (10, 8, 7, ... 1). After `GLEICH.maxTries` (10) tries with no
  agreement the round ends with no points.
- Words: `cleanWord` strips control characters and collapses blanks, max `GLEICH.maxWordLen` 24 code points.

### How it works

- `src/game/gleich/logic.ts:GleichHost` and `src/game/gleich/game.ts:GleichGame`. Intents: `lock {c} | call | vote {v: boolean} |
  ready | end`. Message types: `gg:state`, `gg:intent`, `gg:reveal`, `gg:drop`.
- **Commit/reveal, so the host cannot peek.** `GleichGame.lock` makes a random salt and sends only `c = SHA-256("salt|word")`
  (`commitOf`) as the `lock` intent; the commitments are public in `state.commits` (present = locked). The word and salt stay
  in the private `secret`. Once everyone present has locked (or time is up) the phase becomes `reveal`, and every client
  broadcasts `gg:reveal {round, tryNo, word, salt}`. Each client verifies it against the public commitment
  (`verifyReveal`, which also insists on the cleaned form of the word) and keeps the result in `verified`; the host feeds
  the verified words into `GleichHost.reveal` and judges when all are in or at the deadline. *Why:* the host is a player; if
  words travelled through it in the clear it could change its own word after seeing the others'. With commitments
  nobody can, and anyone can see a mismatch.
- A word that does not match its commitment, or was never revealed, becomes `null` and shows as "—". `wordsView()` also
  blanks a word that a client verified itself as different from the host's report.
- **Private per-player state**: `secret` (own word, salt, commitment, tagged with round and try) and `iVoted` (keyed by
  `round|tryNo|undo`). `myWord` returns the word only while the stored commitment still matches the public one.
- **Rejoin** (`GleichHost.replace`): renames players, group, ready, vote voters, questions, scores, `words`, `history`,
  `revealed` and `votes`, plus the undo history. Special case: in phase `write` the returner's commitment is *deleted*
  (`s.commits[oldId]`), because they lost the secret with the reload and a commitment they cannot reveal is worthless; they
  lock again. After `write` the commitment is only renamed.
- **Reload** (`tabStore('gleich')`): `word.<round>` `{tryNo, word, salt, commit}` is stored when the word is locked and
  `draft.<round>` `{tryNo, text}` on every input; both are removed on a round change and the whole store is cleared at
  `done`. In `write`, after `replace` dropped the returner's commitment, the client re-locks with the *same* commit
  (`relock`, at most every 2 s), so nothing has to be typed again. In `reveal` the restored secret is simply revealed, so a
  reload there no longer shows "—" (the host still waits at most `collectS` for a word that really cannot come back, e.g.
  storage blocked).
- **Host takeover**: `GleichHost.fromState(state, now, skew, ballots)` keeps a running vote with its voters. While a vote
  runs the host sends `ballots` next to `gg:state`; `parseState` strips them from the state and the game keeps them in a
  private field no screen reads. The new host restores the votes from them, rebuilds undo's `beforeVote` from the
  state, and shifts every deadline by `-hostSkew` onto its own clock. It still restarts the `collectS` window if words were
  still being collected; `tick()` then re-feeds the new host with every `verified` word this client has. This works because
  reveals were broadcast to everyone, so every client has checked them.
- **Absent players block nothing.** `GleichHost.present` (set from `net.members()` before every intent and tick) filters
  `here()`: writing ends when all *present* players locked, collecting when all present committed ones revealed, votes and
  "Weiter" when all present answered, and an automatic win needs all present to match. There is no pass timer (nothing is
  per-turn); `GLEICH.absentLeaveS` (30 min) or `drop` removes them (`removePlayer`: their words go with them, fewer than 2
  ends the round).
- **Schaffner**: `penalize` only while `write`, because talking during writing is the cheating the game cares about.
- **Zug zurück**: a decision is the judgment of a try: the automatic win, the closing of a vote, and moving on to the next
  try (`step` pushes the snapshot just before). The snapshot (`Snap`: state plus the words that had arrived,
  `revealed`) goes back to the reveal of that try with the words shown, before the vote, so it can be called and voted on anew;
  `undo` clears `ready` and `vote` and gives the phase a fresh timer. A host `end` pushes `beforeVote ?? snap()` too.
- **Board over heads**: `src/game/gleich/boardImage.ts` draws the words as images; `GleichUi.boardOf(id)` feeds
  `GameEntry.board` (`wordBoard` with style `match`, `word` or `none`).
- **Solo bots**: `src/game/gleich/bots.ts:botWord` writes a first-try word from a fixed list, then follows the group with a
  chance (`followChance`) that rises each try, so a solo round converges; they go through the real commit/reveal path.

## Using it

Start from the lobby bar: pick the game (`T`), press `G` or "Runde starten", host only. In-round keys are listed in the
README rules sections (Wer bin ich?: `F` ask, `R` guess, `P` pass, `1/2/3` vote; Sag's anders: `Space` begin/guessed, `P` skip,
`B` foul or challenge; Gleich gedacht: `Enter` lock, `F` call a vote, `1/2` vote).

## Options

| Config key | Default | Meaning |
| --- | --- | --- |
| `WHOAMI.points` | `[3, 2, 1, 1]` | Points by solving order |
| `WHOAMI.voteS` | 20 | Vote length (room setting `ROOM.voteChoices`) |
| `WHOAMI.absentPassS` / `absentLeaveS` | 8 s / 30 min | Absent turn passes / absent player leaves |
| `WHOAMI.cardPx` / `cardQuality` / `cardMaxChars` | 512 / 0.82 / 600000 | Card image size, JPEG quality, largest accepted payload |
| `SAGS.turnS` | 60 | Seconds per turn (room setting `ROOM.turnChoices`) |
| `SAGS.turnsEach` | 2 | Turns per player |
| `SAGS.teamGot` / `teamFoul` | 1 / 1 | Team points: guessed word / foul by the other team |
| `SAGS.ffaGuesser` / `ffaExplainer` / `ffaFoul` | 2 / 1 / 1 | Free-for-all points and challenge penalty |
| `SAGS.challengeS` | 8 | Challenge window in free for all |
| `SAGS.absentPassS` / `absentLeaveS` | 8 s / 30 min | As above |
| `GLEICH.writeS` / `voteS` / `revealS` / `afterVoteS` / `collectS` | 45 / 15 / 25 / 8 / 4 | Timers in seconds |
| `GLEICH.maxTries` / `points` / `maxWordLen` | 10 / `[10, 8, 7, 6, 5, 4, 3, 2, 2, 1]` / 24 | Tries, payout by try, word length |
| `GLEICH.absentLeaveS` | 30 min | Absent player leaves the round |

## Related links

- [Minigame framework](minigame-framework.md)
- [Zeig drauf / Ahnungslos / Stadt, Land, Fluss](minigames-zeig-ahnungslos-slf.md)
- [Networking](networking.md)
- [Terminology](../meta/TERMINOLOGY.md)
