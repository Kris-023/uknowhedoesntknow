# Shared clock and determinism — same world on every peer, no traffic

Everything ambient in the coach (neon flicker, camera shake, window strobes, oncoming trains, NPCs, tunnel, map details, blackouts, the halt countdown) is a pure function of the shared clock `clock.now()` and the room seed. Peers agree on those two inputs and then compute the same picture locally, so ambient state costs no network messages.

## How it works

- **Seed and start time** come from the host in `welcome` (`src/net/session.ts:welcomeMsg` / `onWelcome`). The host creates its clock with `src/core/clock.ts:SharedClock` (`SharedClock.local`: random seed, `startMs` = local time); a joiner overwrites `seed` and `startMs` with the host's on the first welcome.
- **`SharedClock.now()`** returns seconds since the host started the lobby: `(local + offsetMs - startMs) / 1000`. `offsetMs` is host clock minus local clock (0 on the host).
- **Offset measurement.** Clients ping the host (`src/net/session.ts:tick`): `NET.pingFastCount` (8) pings every `NET.pingFastMs` (250 ms) after joining, then one per `NET.pingSlowMs` (1 s). The host answers `pong` with `[sentLocal, hostMs]`; a client accepts it only from `hostId`.
  - `src/core/clock.ts:addSample` keeps the sample with the **lowest RTT** and sets `offsetMs = hostMs + rtt / 2 - recvLocal`. *Why:* the one-way delay estimate `rtt / 2` has the smallest error when the round trip was fastest; slower samples are noise from jitter and asymmetric paths.
  - `src/core/clock.ts:roughSync` gives a first guess from the single host timestamp in the welcome, so ambience is roughly in step before the first pong. It does not count as a sample.
  - `src/core/clock.ts:resetSamples` is called after host migration and `hostClash` (`pingsSent` restarts too). *Why:* the new host's clock differs from the old one's, and the old best RTT would block fresh samples. The old offset stays until a better one arrives, so nothing jumps.
- **`src/core/clock.ts:localMs`** is `performance.timeOrigin + performance.now()`. *Why:* sub-millisecond resolution, and no jumps from NTP adjustments mid-session.
- **Seeded randomness** (`src/core/rng.ts`):
  - `src/core/rng.ts:mulberry32` is a sequence generator, identical on every browser, used for the world built once from the lobby seed.
  - `src/core/rng.ts:hash01` is a stateless hash of integers to [0, 1), for values derivable from `(seed, index, cycle)` alone without replaying a sequence. *Why:* a peer that joins late or lags must get the value for "now" directly, not by replaying history. Fixed arity instead of rest arguments because it runs thousands of times per frame (tunnel, flicker) and a rest array per call was measurable garbage.
- **Pure motion functions** (`src/core/motion.ts`): `flick`, `coachPower`, `shake`, `windowFlash`, `oncoming`, `haltCountdown`, `nextStopIndex`, `noise1`, `smoothstep`. Time-windowed events (blackouts, oncoming trains) hash the window index: `idx = floor(t / windowS)`, then `hash01(seed, idx, k)` decides whether an event happens and when. Every peer lands on the same answer for the same `t`.
- **What does travel.** Only genuine decisions go over the wire, and always from the host: the train speed profile (`src/net/protocol.ts:Train`; `trainDistance` integrates it, so distance is the same everywhere), a forced debug blackout time (`src/net/session.ts:triggerBlackout` sends a clock time, not an event), and room options. `src/net/session.ts:setSpeed` keeps distance continuous across speed changes by carrying `d0` over. *Why:* sending a profile (speed, start time, start distance) instead of a position stream means a single packet describes all future frames.

### Rules for new ambient features

- Take `t` from `clock.now()`, never from `performance.now()` or `Date.now()` directly, otherwise peers drift apart.
- Derive randomness from `seed` and integers (`hash01`) or from `mulberry32(seed)` at build time; never from `Math.random()` for something every peer must see.
- Keep the function pure (no state carried between frames), put it in `src/core/motion.ts`, and cover it in `tests/motion.test.ts`.
- If a value genuinely cannot be derived (a player's choice, a game result), it is state and goes through the host or the game's own `mg` messages, not through the clock. See [Networking](networking.md).

## Testing

- Runner: vitest (`npm test` runs `vitest run`). Tests live flat in `tests/*.test.ts`, one file per feature or game, plus `tests/fixtures`. `test.exclude` in `vite.config.ts` keeps vitest to this project's own tests.
- `tests/motion.test.ts`, describe "shared-clock determinism": the same seed gives the same `mulberry32` sequence, `hash01` is stateless and in [0, 1), and `flick`, `coachPower`, `shake`, `haltCountdown` stay in range and are reproducible. `tests/frameTrace.test.ts` covers the debug tool's frame statistics, not the clock.
- `tests/session.test.ts` tests the session without WebRTC. `src/net/transport.ts:MemoryHub` is a deterministic in-memory network: `hub.connect(id)` returns a transport and replays join events both ways (a full mesh); `post` queues packets after a JSON round trip, so peers never share object references, exactly like the wire; **nothing is delivered until `hub.flush()`**, which delivers in rounds until the network is quiet; `hub.disconnect(id)` drops that node's queued packets and emits `onLeave` to the others.
- Fake time: `Session` takes a `now` function. The tests' `peer()` helper gives each peer its own wall clock with a fixed skew against a shared mutable `{ ms }`, advances it by hand, and calls `tick()` plus `flush()` in a loop. The clock-sync test asserts the skew is removed to under a millisecond.
- Typical test shape: create peers (the first is host), `hub.flush()`, act (`sendPose`, `setState`, `hub.disconnect`), `hub.flush()`, assert on `roster`, `role`, `mySeat` and recorded events. The session tests cover seat order, "full", migration, rejoin by token, by name and after migration, ambiguous names, and `hostClash`.
- Only `tests/session.test.ts` uses `MemoryHub`. The game tests (`tests/zeig.test.ts`, `tests/slf.test.ts` and others) test each game's pure logic classes directly, with `tests/fixtures/content.ts` standing in for word content.

## Related links

- [Networking](networking.md): roles, welcome, migration; where the ping/pong lives
- [Architecture overview](../architecture/overview.md)
- [Terminology](../meta/TERMINOLOGY.md)
