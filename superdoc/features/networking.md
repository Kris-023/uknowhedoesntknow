# Networking — peer-to-peer rooms for up to four players

Players meet in a room identified by an 8-character code. Signaling goes over public Nostr relays, everything after that is direct WebRTC between the browsers. There is no game server: one player is the host and owns the room's shared facts. The session logic (`Session`) sits on a narrow `Transport` interface, so it runs unchanged against Trystero in the browser and an in-memory network in tests.

## How it works

### Layers

```
src/main.ts:connect / Session callbacks (games, players, pause menu)
        │
src/net/session.ts:Session        roles, roster, seats, rejoin, host migration
        │  typed messages, every payload validated by parse*()
src/net/protocol.ts               wire format + strict parsers
        │
src/net/transport.ts:Transport    send / on / onJoin / onLeave / leave
   ├── src/net/trystero.ts:trysteroTransport   (browser: Nostr signaling, then WebRTC)
   └── src/net/transport.ts:MemoryHub          (tests)
```

- `src/net/transport.ts:Transport` is the only thing `Session` knows about the network. *Why:* host election, seat assignment, migration and rejoin are the fragile parts of the game, and they must be testable without WebRTC (see [Shared clock and determinism](shared-clock-determinism.md), "Testing").
- `src/net/trystero.ts:trysteroTransport` wraps one Trystero room. Each message `type` becomes one Trystero action (`room.makeAction(type)`); a `to` argument turns into `{ target }`. Trystero keeps one handler per event, so the wrapper fans `onPeerJoin`/`onPeerLeave` out to a list (session and voice both listen). It also carries the voice streams (`addStream`; `src/net/trystero.ts:tuneVoice` raises bitrate and priority).
- `src/main.ts:connect` is the glue: roster to seats (`players.applyRoster`), host speed (`train`), blackouts, room options. `Session` stays free of scene code.

### Rooms and access

- The room code is the only access secret. `src/net/roomCode.ts:newRoomCode` draws `NET.codeLength` (8) symbols with `crypto.getRandomValues` from a 31-symbol alphabet (about 40 bits). *Why:* no `0/o`, `1/l/i`, so codes can be read aloud and typed by hand.
- Internal form is lowercase without a dash; `src/net/roomCode.ts:formatRoomCode` is display only (`ABCD-EFGH`). `src/net/roomCode.ts:normalizeRoomCode` accepts what people paste: any case, spaces, dashes, a full link or `#code`; it returns `null` for anything else.
- The code lives in the URL hash (`history.replaceState` in `src/main.ts`) and is also the Trystero password: `joinRoom({ appId: NET.appId, password: code }, code)`. *Why:* the relays then only see encrypted session descriptions, and a hash fragment is never sent to the static host. See the README section "Zugang, Datenschutz und Grenzen" for the user-facing wording.
- `NET.appId` (`'uknowhedoesntknow'`) namespaces the rooms on the relays, so other Trystero apps cannot collide with ours. Trystero picks its relays from a seeded shuffle of the appId, so every client uses the same five; some of them rate-limit.
- There is deliberately no pre-check whether a code is already in use. *Why:* with random codes a collision is about 1 in 850 billion, and if it happens anyway `hostClash` resolves it (below).

### Roles, roster, welcome

- The creator is `host` (`Session` constructor with `host = true`, seat 0); everyone else is `client` and sends `hello` with their `PersonState`, tab token and browser id. The host answers with `welcome` (`src/net/session.ts:welcomeMsg`): seed, `startMs`, current host clock, roster, train, blackout time, room options.
- A client's `welcome` event fires once, on the first welcome. Only then do seed and `startMs` overwrite the local `SharedClock` and the world can be built (`go` in `src/main.ts`). The joiner repeats `hello` every `NET.helloRetryMs` (`src/net/session.ts:tick`) until a host answers, because the host may still be connecting.
- The host owns the roster; every change is re-broadcast (`broadcastRoster`), and clients mirror it (`applyRoster`). A client only accepts `roster`, `train`, `blackout`, `opts` and `pong` from `hostId`.
- Seats fill in `NET.seatOrder = [0, 2, 1, 3]`: the first two players face each other instead of sitting side by side. A fifth joiner gets `full` (`NET.maxPlayers` = 4). Note: games currently derive turn order from the same `seatOrder`.
- Head poses (`pose`, `NET.poseHz` 20, rounded to 3 decimals by `src/net/protocol.ts:encodePose`) go peer to peer, not via the host. *Why:* they are cosmetic and a hop through the host would only add latency.
- Minigame traffic uses one channel `mg` with `{ t, d }` (`src/net/session.ts:sendGame` / `onGame`). Messages from senders not in the roster are dropped. *Why:* one channel keeps the transport generic; games define their own message types.

### Untrusted peers

Every peer is just another browser. All wire data is validated by the strict `parse*` functions in `src/net/protocol.ts`: `parseState`, `parseLook`, `parseRoster`, `parseWelcome`, `parseTrain`, `parseOpts`, `parsePose`, `parseName`. Numbers are range-checked, enums looked up, items only accepted in their own slot, missing fields fall back to defaults (`parseOpts`, `parseLook`), so older peers and saved profiles keep working. Only IDs and numbers travel, never geometry. When adding a message type, add a parser and use it at the receiving end; never cast `data`.

### Rejoin

People reload, lose WiFi or switch browsers, and a round must survive that.

- Everyone who leaves is remembered by **every** peer in `Session.gone` for `NET.rejoinMs` (30 min), together with seat, name and identity keys (`src/net/session.ts:remember`). *Why:* whoever becomes host later must be able to recognise returning players, so the memory cannot live on the host alone.
- Identity keys, in order of strength: tab token (`src/main.ts:tabToken`, `sessionStorage`, survives a reload, a new tab is a new person), browser id (`src/words/custom.ts:playerId`, `localStorage`, same browser in a new tab), then the player's name if exactly one gone player has it and nobody present does (`src/net/session.ts:findGone`). *Why:* another browser knows nothing of the old one, and in a room of friends the name is enough.
- Clients send the raw secrets only to the host in `hello`; the roster carries only short hashes (`src/net/protocol.ts:idHash`, `RosterEntry.keys`). *Why:* the hashes let any peer match a returning player after migration; the hash is not meant to be cryptographic, only to tell a few players apart.
- `src/net/session.ts:onHello` (host): a match gets its old seat back if free, and `ev.rejoin(oldId, newId)` fires; `src/main.ts` forwards it to every game's `rejoin()` so a running round continues under the new id. Seats of recently dropped players are held back from newcomers while other seats are free.
- `src/main.ts:rejoinCode` plus `src/main.ts:markInRoom` (`sessionStorage`): a reload inside a room with the same `#code` goes straight back in without the menu.
- `src/main.ts:absentBar` shows "`<Name>` ist getrennt, der Platz bleibt frei." with a button "Ohne `<Name>` weiterspielen" that calls each game's `drop(id)`. `NET.dropWaitMs` (30 s) is how long such a request waits for the host to notice the player is gone too.

### Host migration and split brain

- When the host leaves, `src/net/session.ts:onLeave` makes the remaining player with the best `seatOrder` rank (longest in the room) the new host. Everyone holds the same roster, so all peers reach the same decision without extra messages. The new host calls `becomeHost`, drops roster entries of peers that are not connected, and keeps seed, clock and train. Other clients just switch `hostId` and `clock.resetSamples()`.
- A client that finds itself no longer in the host's roster (the host noticed a drop) re-sends `hello` with the same token, like a rejoin.
- `src/net/session.ts:hostClash`: if the old host was only cut off and comes back, two hosts exist. They exchange rosters on join; the bigger room wins, a tie goes to the smaller id. Both sides decide identically, and the loser becomes a client and joins the winner like a returning player, so it keeps its seat.
- `NET.orphanMs` (20 s): a joiner without any host sees "Noch niemand im Raum …" with a button "Raum selbst eröffnen" (`src/net/session.ts:takeOver`). The join is not cancelled, a host may still show up. *Why:* Nostr signaling alone can take about 10 s, and taking over too early would split the room in two.

### Failure handling in the UI

- `src/main.ts:showProblem` / `src/main.ts:hideProblem`: one calm notice in the middle for problems, with a hint what to do. The `offline` event shows "Keine Internetverbindung. Sobald sie zurück ist, verbindet sich der Raum von selbst neu."; `online` hides it.
- Trystero join errors only go to `console.warn` (the `onError` callback passed in `src/main.ts`).

### Known limitations

- No STUN `iceServers` are configured. Same-machine Firefox to Firefox can fail ICE; online and with Chrome it works.
- P2P shows players each other's public IP; unavoidable (README, "Zugang, Datenschutz und Grenzen").
- Trystero's fixed relay set means a rate-limiting relay can slow the first connection.

## Using it

Menu: "create" makes a code and opens the room; "join" takes a pasted code or link (`src/ui/menu.ts`). While connecting, the menu shows "Verbinde mit Raum …". The pause menu lists players, role and round-trip time (`pause.setRoom` in `connect`). A full room shows "Der Raum ist voll (4 von 4).".

For multi-device development with `npm run dev:lan`, HTTPS with a throwaway certificate is required (Trystero needs WebCrypto, a secure context), and the host names the dev server accepts come from the environment variable `UKHDK_ALLOWED_HOSTS` (comma-separated, read through Vite's `loadEnv`, so a shell variable or a git-ignored `.env.local` works; unset means Vite's default host check), for example `UKHDK_ALLOWED_HOSTS=<your-host-name> npm run dev:lan`. Details in [debug-build.md](debug-build.md).

## Options

| Config key (`NET` in `src/config.ts`) | Default | Meaning |
| --- | --- | --- |
| `appId` | `'uknowhedoesntknow'` | Relay namespace |
| `maxPlayers` | 4 | Seats |
| `seatOrder` | `[0, 2, 1, 3]` | Fill order |
| `codeLength` | 8 | Room code symbols |
| `poseHz` / `poseKeepAliveMs` / `poseEpsilon` | 20 / 1000 / 0.002 | Head pose rate, keep-alive, minimum change |
| `remoteRate` | 18 | Smoothing of remote heads |
| `rejoinMs` | 30 min | How long a dropped player's seat is remembered |
| `dropWaitMs` | 30 s | Wait for the host before "play on without them" |
| `helloRetryMs` | 2 s | Joiner repeats hello |
| `pingFastMs` / `pingFastCount` / `pingSlowMs` | 250 / 8 / 1000 | Clock ping cadence |
| `orphanMs` | 20 s | Without a host: offer to reopen the room |

## Related links

- [Shared clock and determinism](shared-clock-determinism.md): the ping/pong clock and why ambient state needs no traffic
- [Architecture overview](../architecture/overview.md)
- [Terminology](../meta/TERMINOLOGY.md)
