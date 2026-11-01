# Minigame framework — the contract every game plugs into

A minigame is a host-authoritative state machine that rides on the room's `mg` channel, plus a DOM screen, plus
(solo only) bots. The coach (`src/main.ts`) drives all games through the same few small interfaces, so adding a game
touches the game's own folder plus one registry entry, not the networking or the scene. Read this page before touching
any game; the per-game rules live in [minigames-whoami-sags-gleich.md](minigames-whoami-sags-gleich.md) and
[minigames-zeig-ahnungslos-slf.md](minigames-zeig-ahnungslos-slf.md). Transport, rooms and host election are in
[networking.md](networking.md); terms (Host, Coach, Schaffner, Zug zurück) in [TERMINOLOGY](../meta/TERMINOLOGY.md); the
module map in [overview](../architecture/overview.md).

## How it works

### The interfaces (`src/game/minigame.ts`)

- `src/game/minigame.ts:GameNet` is all a game sees of the network: `selfId`, `isHost()`, `hostId()`, `members()`
  (`{id, seat, name}`), `send(type, data, to?)` and `onMessage`. `src/game/minigame.ts:sessionNet` wraps the real
  `Session` (`session.sendGame`/`onGame`, which wrap everything as `{t, d}` on the `mg` channel);
  `LocalGameRoom.net(id)` is the in-memory twin. *Why:* games never import `Session`, so the same game class runs
  unchanged in a room, in the solo round and in the vitest suites (tests build several game instances over one
  `LocalGameRoom`).
- `src/game/minigame.ts:Minigame`: `start`, `onMessage`, `tick`, `end`, `absent`, `drop`.
  `src/game/minigame.ts:PlayableGame` adds what the coach needs: `state` (`phase`, `round`, optional `undo` counter),
  `running`, `onChange`, `rejoin`, `penalize`, `canUndo`, `undo`.
- `src/game/minigame.ts:GameUi`: `shown` (setter), `doneOpen`, `close`, `tick`. One game's screens are visible at a time
  (`own()` in `launch()`); the others step aside.
- Message types are prefixed per game (`wi:`, `sa:`, `gg:`, `sf:` for the Schaffner call, ...). Every game instance on
  a client hears every `mg` message and ignores the ones that are not its own.

### The game pattern (copy it)

Every game folder has the same four files:

| File | Role |
| --- | --- |
| `logic.ts` | Pure rules: a JSON-serialisable `*State`, `Intent` + `parseIntent`, a `*Host` class with `intent()`, `tick()`, `replace(old,new)`, `removePlayer()`, `penalize()`, `undo()` and a static `fromState()`. No network, no DOM, no clock besides the `now` passed in. |
| `game.ts` | The `Minigame` implementation: wires the `*Host` to `GameNet`. Clients send intents to the host; the host applies them and `publish()`es the whole public state (`<prefix>:state`), also on a 3 s heartbeat. Holds private per-client data (cards, secrets, own votes). |
| `ui.ts` | DOM screens. Reads `game.state`, calls the game's action methods. |
| `bots.ts` | Solo/test bots: extra game instances on a `LocalGameRoom` that act through the same public methods. |

*Why:* the pure `Host` is what the tests drive directly (fast, no network); `game.ts` is thin glue, tested over
`LocalGameRoom`. State that must not be public never enters `*State` (see "private state" in each game).

- **Host authority.** Only the host mutates rules state. Clients accept `<prefix>:state` only when `from` is
  `net.hostId()`, and only after a light shape check (`parseState`); intents go through `parseIntent` and then the
  `Host` (right phase, right player). *Why:* one writer means no merge logic; the host is trusted for game decisions,
  and the checks stop a stranger or a malformed packet from corrupting state.
- **`publish()`** sends `{...structuredClone(host.state), sentAt}`, then applies the same state locally. `sentAt` lets
  clients estimate `hostSkew`, so deadlines (host wall-clock ms) render right on other clocks.
- **Rounds.** `start()` (host, at least 2 members) sorts members by `NET.seatOrder.indexOf(seat)` to get turn order,
  carries `scores` over from the previous host state and bumps `round`. `NET.seatOrder` is currently `[0, 2, 1, 3]`
  (a zig-zag fill order) and every game reads the same expression, so turn order follows that array. A change of the
  seating direction is planned; it would be made there.

### Players, NPCs, fake peers

- `src/game/players.ts:Players` holds the four seated `Person`s. `active` is the local seat; `mode` is `'fake'` (solo:
  the other seats are scripted) or `'net'` (a roster applied via `applyRoster`; empty seats stay invisible through
  `occupied`). `headPos`, `cardPos` and `labelPos` give world anchors for the gaze picker, the card overlays and the
  name tags.
- `src/game/fakePeers.ts:fakePeer` is the scripted stand-in for a remote player in solo mode: a pure function of the
  clock (idle sway, now and then a slow look at another seat, one speaker at a time). *Why:* a pure function of time
  needs no state or network and is reproducible in screenshots.
- `src/game/npcs.ts:Npcs` are the map's extra passengers; their look comes from the lobby seed and their behaviour from
  the shared clock, so every client sees the same scene with zero messages. `src/game/crowd.ts:bakeCrowd` bakes the
  neighbour-coach passengers into one geometry (one draw call). Neither takes part in game logic.

### Solo round (`LocalGameRoom`)

With no session, `launch()` builds `members` from the four seats (you as `'me'`, the others as `bot<seat>`), puts you
first and creates a `src/game/minigame.ts:LocalGameRoom`: **the first roster entry is the host**. Messages go through a
`MemoryHub` and are delivered on `pump()` (each game's `Bots.tick` calls `room.pump()`), so they arrive a frame later,
like on a real network. Bots are extra game instances, e.g. `src/game/whoami/bots.ts:WhoamiBots`, acting only through
the public methods. `roster` is mutable so tests can make someone leave and come back.

### Lobby (`src/game/lobby.ts`)

- `src/game/lobby.ts:GAMES` (a list of `GameInfo`: `id`, `title`, `blurb`, `min` players) drives the host's game
  picker, the Esc-menu buttons and the "mindestens N Spieler" notes. `GameId` is the union of ids.
- `src/game/lobby.ts:GameLobby` is the top bar while idle (`LobbyRoom.idle()`: no running game and no end screen open).
  Keys: `G` starts, `T` cycles the game (host only, ignored while typing in an input). `LobbyOption` lets a game offer a
  mode switch (used by Stadt, Land, Fluss); `deckNote` shows the state of the built-in decks.
- `update()` runs per frame but rebuilds the DOM only when its composed `key` string changes.

### Zug zurück (undo) — `src/game/undo.ts`, `src/ui/undoButton.ts`

- The host keeps the last `UNDO.depth` (5) decisions as full snapshots: `src/game/undo.ts:UndoStack` `push(snap, at)`
  right *before* the decision resolves, `pop()` on undo. Snapshots are `structuredClone`d and live only on the host.
- What counts as a decision is per game (a resolved vote, a pass, a card result, a judged try, a reveal). Each `Host`
  owns one `UndoStack` and exposes `canUndo`/`undo()`; the game's `undo()` publishes the restored state.
- `state.undo` is a counter bumped on every undo. Clients key what they remember per step on it
  (`src/game/undo.ts:stepKey` = `round.undo`; whoami's `myVote`, gleich's `iVoted` and the bots do the same), so a
  dismissed banner or a cast vote is asked for again after an undo. `main.ts` also flashes "... hat den letzten Zug
  zurückgenommen" to everyone when the counter grows.
- **Fines survive.** `UndoStack.fine()` tracks Schaffner fines; `pop()` returns the later ones as `later`, and
  `src/game/undo.ts:keepFines` re-applies them after restoring. *Why:* shouting is not a game move; taking back a vote
  should not pardon whoever was too loud meanwhile.
- **Knowledge survives.** State goes back, what a client was already shown stays (a revealed whoami card, the word at
  the end of Ahnungslos). Stated in the header comment of `undo.ts`.
- **History ends** on `removePlayer` (an undo would bring a departed player back) and on host takeover (new host,
  empty stack). **Rejoin keeps it**: `UndoStack.rename` runs `src/game/undo.ts:renameDeep` over every snapshot, so an
  undo never resurrects the old id. `renameDeep` swaps string values and record keys equal to the old id. *Why* that is
  safe: ids are long random strings, so no word or question can be mistaken for one.
- UI: `src/ui/undoButton.ts:UndoButton`, one shared control for all games (corner button, `Backspace`, also from the Esc
  menu via `open(true)`). It **always asks first** ("Letzten Zug zurücknehmen?"; `Enter` confirms, `Esc`/`Backspace`
  cancel) in a capture-phase key handler. *Why:* one stray key must not undo a vote the whole table agreed on. It is
  offered only to the host (`undoTarget()` in `launch()`), and also right after a round ended, because the last decision
  may have been the wrong one.

### Schaffner (`src/game/schaffner.ts`)

- `src/game/schaffner.ts:LoudTracker` `feed(levels, dt, nowS)`: per player a leaky bucket; a level of at least
  `SCHAFFNER.loudLevel` fills it, quiet drains it, so "`loudS` of shouting within `windowS`" triggers; `cooldownS`
  per player. Returns the id to scold.
- Only the host measures (per-frame loop in `launch()`: own mic level plus the received audio of each peer; skipped
  when the room's `schaffner` option is `'off'`), then broadcasts `sf:call {id}` and calls `callSchaffner` itself.
  Clients accept `sf:call` only from the host.
- `src/game/schaffner.ts:SchaffnerFigure` is the 3D conductor shown beside the seat for `showS`.
- The fine: `callSchaffner` asks every game `penalize(id, SCHAFFNER.penalty)`; a game returns `false` when a fine makes
  no sense right now (Gleich only while people write, whoami only in `play`). On clients `GameEntry.fineable()` guesses
  the same so the announcement text matches. Room setting `'warn'` only scolds. *Why:* the host decides for real; the
  client guess only picks the wording of the announcement.

### Gaze picking (`src/game/gaze.ts`)

Games where people pick a player by looking (Zeig drauf, the Ahnungslos vote) opt in with `GameEntry.gaze`
(`src/game/gaze.ts:GazeTarget`: `pickable()`, `aim(id)`, `lockedPick`).

- `src/game/gaze.ts:gazePick` is the pure core: smallest angle to the view ray within `GAZE.maxAngleDeg`; the current
  pick gets `stick` extra radians so it does not flicker between close heads.
- `src/game/gaze.ts:Gaze` `pick(seats)` is the scene side (camera ray vs head positions, never your own seat).
  `src/game/gaze.ts:PickState` is the client's pick for one question: `reset(key)`, `flush(host, send)` sends only
  changes, throttled to `GAZE.sendMs` with locking going out at once, and resends everything to a new host (`forget()`).
- `aimGaze()` in `launch()` feeds the `pickable()` ids into `Gaze` each frame (POV camera only) and highlights the pick
  on the name tags and head cards.

### Absent players and rejoin/host takeover (the pattern every game follows)

- **Rejoin.** A reload gives a new peer id. `Session` matches the returner to the old seat (tab token, browser id or
  name, within `NET.rejoinMs`) and fires `rejoin(old, new)`; `launch()` forwards it to every game
  (`session?.listen({ rejoin })`). Each host-side game calls `Host.replace(old, new)`, which renames the id everywhere:
  players, turn, teams, scores, votes, `ready`, logs and the undo history. Then `publish()`. Games with private data
  also re-send what the returner lost (whoami cards).
- **Host takeover.** When the host leaves, the next member becomes host. In `tick()` a game that `isHost` but has no
  host object builds one with `Host.fromState(lastPublicState)`. Everything that lived only on the old host is gone:
  undo history and secret in-flight votes (a running vote is cleared). Conversely a game that sees `!isHost` while
  holding a host object drops it (network split: the other host's state wins).
- **Absent players never block.** `absent()` lists round players who are not in `net.members()`. "Everyone answered"
  checks are filtered by who is present (whoami `closeIfAllIn`, gleich `present`). Turn games pass an absent player's
  turn after `absentPassS` (8 s; whoami, sags). After `absentLeaveS` (30 min, the same as `NET.rejoinMs`) the host
  calls `removePlayer`.
- **"Ohne X weiterspielen".** `absentBar()` in `main.ts` polls `absent()` every 500 ms and shows a row per missing
  player with a button that calls `drop(id)` on every game that lists them. Anyone may press it; clients forward
  `<prefix>:drop` to the host, and the host only removes someone who is really gone (`dropNow`): if it still sees them
  in `members()` it remembers the request for `NET.dropWaitMs` (30 s) and acts when they vanish. *Why:* the asker may
  see the drop-out a moment before the host does.
- `removePlayer` clears the undo history and ends the round when fewer than 2 players are left.

## Using it — how to add a game

1. Create `src/game/<name>/` with `logic.ts`, `game.ts`, `ui.ts`, `bots.ts` following the pattern above, with a unique
   message prefix. Write `Host.replace`, `removePlayer`, `fromState`, `penalize` and `undo` from the start; retrofitting
   rejoin and takeover is where bugs hide. Put tunables into a `const` block in `src/config.ts` (including
   `absentPassS`/`absentLeaveS` when turns exist).
2. `src/game/lobby.ts`: add the id to `GameId` and an entry to `GAMES` (`title`, `blurb`, `min`).
3. `src/main.ts` `launch()`: construct the game and its UI with `gameNet`, then add one `GameEntry` to `games`:
   `id`, `game`, `ui`, `bots: botsFor((r, ids) => new <Name>Bots(r, ids, ...))`, `closeOn` (phases that must close the
   Esc menu, e.g. `['done']`), `fineable()`, optionally `board(id)` (text or image over a head) and `gaze`. Start,
   scoreboard ownership, the Schaffner, rejoin forwarding, the absent bar, undo and the per-frame
   `game.tick`/`bots.tick`/`ui.tick` all loop over `games`, so no further wiring is needed.
4. Implement `penalize` so it returns `false` when a fine is out of place; `src/game/schaffner.ts` needs no change.
5. Tests: a pure-`Host` suite (rules, undo, `replace`, `removePlayer`, `fromState`) and a `LocalGameRoom` suite
   (private data, rejoin, takeover, absent players); see `tests/whoami.test.ts` and `tests/undo.test.ts`.
6. Update this page, the game's page under `superdoc/features/` and the README rules section.

## Options

| Config key | Default | Meaning |
| --- | --- | --- |
| `UNDO.depth` | 5 | Decisions kept per round for Zug zurück |
| `UNDO.resumeMinS` | 10 | Least number of seconds a taken-back Sag's-anders turn resumes with |
| `NET.seatOrder` | `[0, 2, 1, 3]` | Turn order of every game |
| `NET.rejoinMs` | 30 min | How long a returner gets seat and place back |
| `NET.dropWaitMs` | 30 s | How long a "weiterspielen" request waits for the host to see the player gone |
| `SCHAFFNER.loudLevel / loudS / windowS / cooldownS / penalty / showS` | 0.97 / 2.5 / 5 / 30 / 1 / 7 | Shouting trigger and fine |
| `GAZE.maxAngleDeg / stickDeg / sendMs` | 18 / 3 / 120 | Gaze pick cone, stickiness, send throttle |

## Related links

- [Whoami / Sag's anders / Gleich gedacht](minigames-whoami-sags-gleich.md)
- [Zeig drauf / Ahnungslos / Stadt, Land, Fluss](minigames-zeig-ahnungslos-slf.md)
- [Networking](networking.md)
- [Architecture overview](../architecture/overview.md)
- [Terminology](../meta/TERMINOLOGY.md)
