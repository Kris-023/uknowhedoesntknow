import * as THREE from 'three';
import { Ambience } from './audio/ambience';
import { echoNeedsHeadphones, getVoice, type Voice } from './audio/voice';
import type { PersonState } from './characters/person';
import { AMBIENCE, CAMERA, HEAD, LIGHT_PRESETS, LIGHTS, NET, SCHAFFNER, VOICE } from './config';
import { SharedClock } from './core/clock';
import { DebugPanel } from './debug/panel';
import { sceneTree } from './debug/sceneTree';
import { setSightMode } from './debug/sight';
import { randomState } from './game/players';
import { parseName, trainDistance, type RoomOpts } from './net/protocol';
import { Session } from './net/session';
import { trysteroTransport } from './net/trystero';
import { Pipeline } from './render/pipeline';
import { World } from './scene/world';
import { el } from './ui/dom';
import { BenchPanel } from './ui/benchPanel';
import { MouseTrace } from './debug/mouseTrace';
import { GpuTimer, HeapWatch } from './debug/gpuTimer';
import { MainMenu, PauseMenu, type LobbyChoice } from './ui/menu';
import { MicHud } from './ui/micHud';
import { NameTags } from './ui/nametags';
import { LocalGameRoom, sessionNet, type GameNet } from './game/minigame';
import { LoudTracker, SchaffnerFigure } from './game/schaffner';
import { WhoamiBots } from './game/whoami/bots';
import { CardsView } from './game/whoami/cardsView';
import { WhoamiGame } from './game/whoami/game';
import { WhoamiUi } from './game/whoami/ui';
import { GameLobby, GAMES, type GameId } from './game/lobby';
import { SagsBots } from './game/sagsanders/bots';
import { SagsGame } from './game/sagsanders/game';
import { SagsUi } from './game/sagsanders/ui';
import { customCards, playerId } from './words/custom';
import { initUiScale } from './ui/scale';
import { loadProfile, onSettings, saveProfile, settings } from './ui/store';
import './style.css';

// The prototype's palette was tuned on r128, where hex colours went into the shader unconverted.
// Turning colour management off keeps those hex values looking the same; textures still decode sRGB.
THREE.ColorManagement.enabled = false;

const stage = document.getElementById('stage')!;
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
/** Debug panel only for development, or on request with ?debug. */
const debug = import.meta.env.DEV || params.has('debug');

const saved = loadProfile();
let profile: PersonState = saved ?? { ...randomState(Math.random), name: '' };
const setProfile = (p: PersonState) => {
  profile = p;
  if (parseName(p.name)) saveProfile(p);
};

initUiScale();

const applyLight = () => Object.assign(LIGHTS, LIGHT_PRESETS[settings.light]);
applyLight();
onSettings(applyLight);

void start();

/**
 * Menu first: a joiner only learns seed and start time from the host's welcome, and the whole
 * world (tunnel, flicker, fake peers) is built from that seed.
 */
async function start(): Promise<void> {
  document.getElementById('boot')?.remove();
  // ?seed=… skips the menu: deterministic solo scene for screenshots and debugging.
  if (seedParam) {
    launch(new SharedClock(+seedParam | 0, performance.timeOrigin + performance.now()), null, 'wagon');
    return;
  }
  const menu = new MainMenu(document.body, profile, setProfile);
  // Reload inside a room (same tab, same #code): straight back in, no menu clicks.
  const back = rejoinCode();
  const choice: LobbyChoice = back ? { kind: 'join', code: back } : await menu.choose();
  saveProfile(profile);
  // Still within the click's user activation: audio may start and the mic may be asked for now.
  // After an automatic rejoin there was no click yet: audio starts with the first one.
  const voice = getVoice(true);
  voice?.resume();
  if (back) for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => voice?.resume(), { once: true });
  // Mic now for the benchmark and own rooms with voice; a joiner asks only once the welcome says
  // the room has voice chat, so quiet rooms never show the permission prompt.
  const micWanted = choice.kind === 'bench' || (choice.kind === 'create' && choice.opts.voice);
  if (voice && settings.micOn && micWanted && voice.micState !== 'on') void voice.startMic();
  if (voice && choice.kind === 'create') voice.setRoomVoice(choice.opts.voice);
  const clock = SharedClock.local();
  if (choice.kind === 'bench') {
    menu.close();
    launch(clock, null, 'pov', '', voice, true);
    return;
  }
  const { code } = choice;
  history.replaceState(null, '', `#${code}`);
  const net = trysteroTransport(code, (msg) => console.warn('Trystero:', msg));
  voice?.bind(net);
  const session = new Session(net, clock, choice.kind === 'create', profile, undefined, tabToken(code));
  markInRoom(code);
  if (choice.kind === 'create') session.setOpts(choice.opts);
  addEventListener('pagehide', () => session.leave());
  // Pings and hello retries keep running while the tab is in the background.
  setInterval(() => session.tick(), 50);

  const go = () => {
    if (voice && choice.kind === 'join') {
      voice.setRoomVoice(session.opts.voice);
      if (session.opts.voice && settings.micOn && voice.micState !== 'on') void voice.startMic();
    }
    menu.close();
    launch(clock, session, 'pov', code, voice);
  };
  if (session.welcomed) go();
  else {
    menu.connecting(code, () => session.takeOver());
    session.listen({
      welcome: go,
      status: (s) => {
        if (s === 'full' && !session.welcomed) menu.message(`Der Raum ist voll (${NET.maxPlayers} von ${NET.maxPlayers}).`);
      },
    });
  }
}

function launch(clock: SharedClock, session: Session | null, startCam: 'wagon' | 'pov', code = '', voice: Voice | null = null, bench = false): void {
  const world = new World(clock);
  const players = world.players;

  let pipeline: Pipeline | null = null;
  try {
    pipeline = new Pipeline(stage, world.scene, world.camera);
    // Graphics driver reset or GPU memory pressure: the canvas is dead, but the room isn't.
    // A reload brings everything back, and the automatic rejoin keeps the seat.
    pipeline.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      showProblem('Die Grafik ist abgestürzt (WebGL-Kontext verloren).', 'Neu laden', () => location.reload());
    });
  } catch {
    const msg = document.createElement('div');
    msg.className = 'nogl';
    msg.textContent = 'WebGL ist in diesem Browser nicht verfügbar. uKnowHeDoesntKnow braucht WebGL 2.';
    stage.prepend(msg);
  }

  const hint = el('div', 'hint-bar');
  hint.setAttribute('role', 'status');
  document.body.append(hint);

  const panel = new DebugPanel(
    document.body,
    players,
    {
      onSight: (on) => {
        setSightMode(world.scene, on);
        applyBloom();
      },
      onCam: (cam) => {
        world.cam = cam;
        players.instant = cam === 'pov';
        stage.classList.toggle('look', cam === 'pov');
        syncHint();
        if (cam !== 'pov' && document.pointerLockElement) document.exitPointerLock();
      },
      onBlackout: () => {
        if (session) session.triggerBlackout(clock.now());
        else world.forcedBlackoutAt = clock.now();
      },
      onLocalChange: () => {
        if (!players.isLocal(players.active)) return;
        session?.setState(players.me.state());
      },
      tree: () => sceneTree(world.scene),
    },
    debug,
  );
  const applyBloom = () => {
    if (!pipeline) return;
    pipeline.bloomOn = settings.bloom && !panel.state.sight;
    pipeline.bloomStrength = settings.bloomStrength;
    pipeline.setRenderScale(settings.renderScale);
  };
  applyBloom();
  onSettings(applyBloom);

  // Your own character: the menu profile goes onto your seat (in a room it came with the hello).
  if (!session) players.applyState(players.active, profile);
  const pause = new PauseMenu(
    document.body,
    profile,
    (p) => {
      setProfile(p);
      players.applyState(players.active, p);
      session?.setState(p);
    },
    bench,
  );
  const toMenu = () => {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  };
  const mouseK = () => CAMERA.mouseSensitivity * settings.mouseSens * world.fovFactor;
  const trace = bench ? new MouseTrace() : null;
  const benchPanel = bench ? new BenchPanel(document.body, toMenu, trace, mouseK) : null;
  // Benchmark diagnostics: GPU time per frame (where the browser has timer queries) and GC as heap drops.
  const gpuTimer = benchPanel && pipeline ? GpuTimer.create(pipeline.renderer.getContext()) : null;
  const heap = benchPanel ? new HeapWatch() : null;
  if (benchPanel) benchPanel.diag = { gpuTimer: !!gpuTimer, heapPrecise: () => !!heap?.precise };
  if (bench) document.body.classList.add('benching');
  const tags = new NameTags(document.body, players, world.camera, stage);
  const micHud = voice ? new MicHud(document.body, voice) : null;
  const ambience = voice ? new Ambience(voice, clock.seed) : null;
  // Quiet start: no crackle while the world settles in (see Voice.holdOutput).
  voice?.holdOutput();
  let smooth = 0;
  let held = !!voice;
  const launchedAt = performance.now();
  // Compile shaders in the background where the browser supports it, so the first frames hitch less.
  if (pipeline) void pipeline.renderer.compileAsync(world.scene, world.camera).catch(() => {});

  // Voice levels: measured once per frame, read by mouths and name tags.
  const levels = [0, 0, 0, 0];
  const seatIds: (string | null)[] = [null, null, null, null];
  const idToSeat = new Map<string, number>();
  const refreshSeats = () => {
    seatIds.fill(null);
    idToSeat.clear();
    for (const e of session?.roster.values() ?? []) {
      seatIds[e.seat] = e.id;
      idToSeat.set(e.id, e.seat);
    }
  };
  const measureVoices = () => {
    for (let i = 0; i < levels.length; i++) {
      const id = seatIds[i];
      if (i === players.active) levels[i] = voice?.micState === 'on' ? voice.micLevel() : -1;
      else levels[i] = voice && id && voice.hasPeer(id) ? voice.peerLevel(id) : -1;
    }
  };
  // -1 = no real voice on that seat: solo fake peers keep their scripted mouths.
  players.voiceLevel = (seat) => (levels[seat] >= 0 ? levels[seat] : null);
  if (voice) {
    pause.volume = { get: (id) => voice.volumeOf(id), set: (id, v) => voice.setVolume(id, v) };
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (e.code === VOICE.pttKey) voice.setPtt(true);
      if (e.code === VOICE.muteKey && !e.repeat) voice.setMuted(!voice.muted);
    });
    addEventListener('keyup', (e) => {
      if (e.code === VOICE.pttKey) voice.setPtt(false);
    });
    // Releasing the key in another window would leave push-to-talk stuck open.
    addEventListener('blur', () => voice.setPtt(false));
  }
  const voicePos = new THREE.Vector3();

  if (session) connect(session, world, panel, pause, code, refreshSeats);

  // Minigames ("Wer bin ich?", "Sag's anders"): over the room, or solo against bots on the other seats.
  let bots: WhoamiBots | null = null;
  let sagsBots: SagsBots | null = null;
  let gameNet: GameNet;
  // Solo: your own settings for the next room stand in for the host's.
  const roomOpts = () => session?.opts ?? settings.room;
  const sagsRoom = { decks: () => roomOpts().decks, turnS: () => roomOpts().turnS, teams: () => roomOpts().sagsTeams };
  if (session) gameNet = sessionNet(session);
  else {
    const members = players.people.map((p, i) => ({ id: i === players.active ? 'me' : `bot${i}`, seat: i, name: i === players.active ? profile.name : p.name }));
    // The local player first: the first member is the host of the local room.
    members.sort((a, b) => Number(b.id === 'me') - Number(a.id === 'me'));
    const room = new LocalGameRoom(members);
    gameNet = room.net('me');
    const ids = members.slice(1).map((m) => m.id);
    bots = new WhoamiBots(room, ids);
    sagsBots = new SagsBots(room, ids, sagsRoom);
  }
  // Dev only: ?voteS=120 stretches votes, so slow test browsers don't run out of time.
  const devVoteS = import.meta.env.DEV ? Number(params.get('voteS')) || undefined : undefined;
  const whoami = new WhoamiGame(gameNet, devVoteS);
  whoami.roomVoteS = () => session?.opts.voteS;
  const sags = new SagsGame(gameNet, sagsRoom, () => ({ pid: playerId(), cards: customCards() }));
  // Someone reloaded and came back: they keep seat, points and their place in the round.
  session?.listen({
    rejoin: (oldId, newId) => {
      whoami.rejoin(oldId, newId);
      sags.rejoin(oldId, newId);
    },
  });
  const hostName = () => gameNet.members().find((m) => m.id === gameNet.hostId())?.name || 'der Host';
  const micWarning = () => {
    if (!voice || !voice.roomVoice) return null;
    if (voice.micState !== 'on') return 'Dein Mikro ist aus: die anderen hören dich nicht (Esc → Einstellungen).';
    if (voice.muted) return 'Du bist stumm geschaltet: M drücken.';
    return null;
  };
  const whoamiRunning = () => !!whoami.state && whoami.state.phase !== 'done';
  // Only one game at a time; starting one ends the other and closes both end screens.
  const startGame = (id: GameId) => {
    wiUi.closeDone();
    saUi.close();
    if (id === 'whoami') {
      if (sags.running) sags.end();
      whoami.start();
    } else {
      if (whoamiRunning()) whoami.end();
      sags.start();
    }
    lobby.pick(id);
  };
  const wiUi = new WhoamiUi(document.body, whoami, () => gameNet.members(), { hostName, start: () => startGame('whoami'), micWarning });
  const saUi = new SagsUi(document.body, sags, () => gameNet.members(), {
    hostName,
    start: () => startGame('sags'),
    flash: (title, big, tone, sub) => wiUi.flash(title, big, tone, sub),
    micWarning,
  });
  const lobby = new GameLobby(document.body, {
    isHost: () => gameNet.isHost(),
    hostName,
    players: () => gameNet.members().length,
    idle: () => !whoamiRunning() && !sags.running && !wiUi.doneOpen && !saUi.doneOpen,
    solo: !session,
    start: startGame,
  });
  // The game last started owns the scoreboard; the other one's board steps aside.
  let current: GameId | null = null;
  const own = (id: GameId) => {
    if (current === id) return;
    current = id;
    wiUi.shown = id === 'whoami';
    saUi.shown = id === 'sags';
  };
  const cards = new CardsView(document.body, players, world.camera, stage);
  // Phase changes that need the screen: a new card to make or the end of round close the Esc menu.
  let lastPhase = '';
  whoami.onChange(() => {
    const phase = whoami.state?.phase ?? '';
    if (whoamiRunning()) own('whoami');
    if (phase !== lastPhase && (phase === 'done' || phase === 'cards') && pause.isOpen) pause.close();
    lastPhase = phase;
    syncHint();
  });
  let lastSags = '';
  sags.onChange(() => {
    const phase = sags.state?.phase ?? '';
    if (sags.running) own('sags');
    if (phase !== lastSags && phase === 'done' && pause.isOpen) pause.close();
    lastSags = phase;
    syncHint();
  });
  const cardOf = (seat: number): string | '?' | null => {
    const s = whoami.state;
    const id = gameNet.members().find((m) => m.seat === seat)?.id;
    if (current !== 'whoami' || !s || s.phase === 'cards' || !id || !s.players.includes(id)) return null;
    // Your own card stays a question mark until you have solved it.
    if (id === gameNet.selfId) return whoami.cards.get(id) ?? '?';
    return whoami.cards.get(id) ?? null;
  };
  pause.gameControls = () => {
    const box = el('div', 'room-box');
    box.append(el('span', 'eyebrow', 'Minigame'));
    const running: GameId | null = whoamiRunning() ? 'whoami' : sags.running ? 'sags' : null;
    const row = el('div', 'row');
    if (gameNet.isHost()) {
      const enough = gameNet.members().length >= 2;
      for (const g of GAMES) {
        if (running && running !== g.id) continue;
        const b = el('button', running ? 'btn big' : 'btn', running ? `${g.title}: Runde beenden` : session ? `${g.title} starten` : `${g.title}: Testrunde`);
        b.type = 'button';
        b.disabled = !running && !enough;
        b.addEventListener('click', () => {
          if (running === 'whoami') whoami.end();
          else if (running === 'sags') sags.end();
          else startGame(g.id);
          pause.onResume();
        });
        row.append(b);
      }
      if (!enough) row.append(el('span', 'note', 'Mindestens zwei Spieler.'));
    } else row.append(el('span', 'note', running ? `${GAMES.find((g) => g.id === running)!.title}: eine Runde läuft.` : 'Der Host startet die Runde.'));
    box.append(row);
    return box;
  };

  // The Schaffner: the host listens for shouting in everyone's audio and calls him.
  const schaffner = new SchaffnerFigure(world.coach.root);
  const loud = new LoudTracker();
  const callSchaffner = (id: string) => {
    const m = gameNet.members().find((x) => x.id === id);
    if (!m) return;
    schaffner.show(m.seat, clock.now());
    // Room setting: 'warn' only tells off, 'fine' also costs a point (only while a round is played).
    const fineOn = (session?.opts.schaffner ?? 'fine') === 'fine';
    const fined = fineOn && (gameNet.isHost() ? whoami.penalize(id, SCHAFFNER.penalty) || sags.penalize(id, SCHAFFNER.penalty) : whoami.state?.phase === 'play' || sags.running);
    ambience?.announce(`Durchsage für ${m.name || 'Fahrgast'}: Etwas leiser bitte!${fined ? ' Das kostet einen Punkt.' : ''}`);
    const mine = m.id === gameNet.selfId;
    wiUi.flash(
      mine ? 'Der Schaffner steht neben dir' : `Schaffner bei ${m.name || 'Fahrgast'}`,
      fined ? '−1 Punkt' : 'Etwas leiser!',
      'bad',
      `${mine ? 'Du warst' : `${m.name || 'Jemand'} war`} zu lange zu laut.`,
    );
  };
  gameNet.onMessage((type, data, from) => {
    if (type === 'sf:call' && from === gameNet.hostId() && typeof (data as { id?: unknown })?.id === 'string') callSchaffner((data as { id: string }).id);
  });
  const loudLevels = new Map<string, number>();
  panel.setCam(startCam);

  function resize(): void {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    world.camera.aspect = w / h;
    world.camera.updateProjectionMatrix();
    pipeline?.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  function syncHint(): void {
    const locked = document.pointerLockElement === stage;
    hint.hidden = world.cam !== 'pov' || locked || pause.isOpen;
    const echo = !bench && !!voice?.roomVoice && echoNeedsHeadphones;
    hint.replaceChildren('Klick ins Bild, um dich umzusehen · Esc öffnet das Menü');
    if (echo) hint.append(el('span', 'hint-echo', 'Kopfhörer empfohlen: ohne hören die anderen sich selbst als Echo'));
  }
  syncHint();

  // Click into the scene to look around: the mouse turns your character's head (pointer lock).
  stage.addEventListener('click', () => {
    if (world.cam === 'pov' && !document.pointerLockElement) lockMouse(stage);
  });
  let unlockedAt = -Infinity;
  // A game dialog took the mouse on purpose (card maker, end of round): no pause menu then.
  let quietUnlock = false;
  addEventListener('ukhdk:release-mouse', () => {
    quietUnlock = true;
    document.exitPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === stage;
    document.body.classList.toggle('locked', locked);
    // Esc while looking around releases the mouse (browser rule); that's when the menu opens.
    // In the benchmark the side panel is the menu: releasing the mouse just frees it for the panel.
    if (!locked && world.cam === 'pov') {
      unlockedAt = performance.now();
      if (!bench && !quietUnlock) pause.open();
      quietUnlock = false;
    }
    syncHint();
  });
  pause.onResume = () => {
    pause.close();
    syncHint();
    // A game dialog (card maker, end of round) needs the mouse; don't grab it back then.
    if (world.cam === 'pov' && !document.body.classList.contains('wi-dialog')) lockMouse(stage);
  };
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || world.cam !== 'pov') return;
    // The Esc that just released the pointer lock already opened the menu.
    if (performance.now() - unlockedAt < 300) return;
    if (pause.isOpen) pause.close();
    else pause.open();
    syncHint();
  });

  // Hold the right mouse button in POV to zoom, e.g. to read the card on someone's head.
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('mousedown', (e) => {
    if (e.button === 2 && world.cam === 'pov') world.zoom = 1;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 2) world.zoom = 0;
  });
  // Two possible sources, one active at a time (see settings.mouseRaw). Raw events arrive as the
  // device sends them instead of once per frame; in Zen that felt clearly less sluggish.
  const rawMouse = 'onpointerrawupdate' in window;
  const onLook = (e: MouseEvent, raw: boolean) => {
    if (raw !== (settings.mouseRaw && rawMouse) || document.pointerLockElement !== stage) return;
    const k = mouseK();
    const look = players.look;
    look.yaw = Math.max(-HEAD.maxYaw, Math.min(HEAD.maxYaw, look.yaw - e.movementX * k));
    const dy = (settings.invertY ? -1 : 1) * e.movementY;
    look.pitch = Math.max(HEAD.minPitch, Math.min(HEAD.maxPitch, look.pitch + dy * k));
  };
  document.addEventListener('mousemove', (e) => {
    trace?.move(e, document.pointerLockElement === stage);
    onLook(e, false);
  });
  addEventListener('pointerrawupdate', (e) => {
    trace?.raw(e as PointerEvent, document.pointerLockElement === stage);
    onLook(e as PointerEvent, true);
  });

  let last = performance.now();
  let fps = 60;
  let lastStat = 0;
  const sent = { yaw: NaN, pitch: NaN, at: -Infinity };
  function frame(now: number): void {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const workStart = performance.now();
    const rawMs = now - last;
    const dt = Math.min(0.05, Math.max(0.001, rawMs / 1000));
    last = now;
    if (held) {
      smooth = rawMs < AMBIENCE.stableFrameMs ? smooth + 1 : 0;
      if (smooth >= AMBIENCE.stableFrames || now - launchedAt > AMBIENCE.maxHoldS * 1000) {
        held = false;
        voice?.releaseOutput();
      }
    }
    fps = fps * 0.92 + (1 / dt) * 0.08;
    const t = clock.now();
    panel.tick();

    // Speed: the host (or solo player) turns the slider into a new profile; clients follow the host.
    if (panel.state.kmh !== world.train.kmh) {
      if (!session) world.train = { kmh: panel.state.kmh, t0: t, d0: trainDistance(world.train, t) };
      else if (session.role === 'host') session.setSpeed(panel.state.kmh, t);
    }
    // Head pose: send the target (not the smoothed head), so remote smoothing is the only lag.
    if (session?.welcomed) {
      const { yaw, pitch } = players.look;
      const moved = Math.abs(yaw - sent.yaw) > NET.poseEpsilon || Math.abs(pitch - sent.pitch) > NET.poseEpsilon;
      if ((moved && now - sent.at >= 1000 / NET.poseHz) || now - sent.at >= NET.poseKeepAliveMs) {
        session.sendPose(yaw, pitch);
        Object.assign(sent, { yaw, pitch, at: now });
      }
    }

    measureVoices();
    world.update(t, dt, settings);
    whoami.tick(now);
    sags.tick(now);
    bots?.tick(now);
    sagsBots?.tick(now);
    wiUi.tick();
    saUi.tick();
    lobby.update();
    players.showMarkers = !whoamiRunning() && !sags.running;
    cards.update(cardOf, (seat) => players.people[seat].name, world.cam === 'pov');
    // A card carries the name; the separate tag steps aside meanwhile.
    tags.update(world.cam === 'pov', (i) => Math.max(0, levels[i]), (i) => cards.shown.has(i));
    schaffner.update(t, dt);
    if (gameNet.isHost() && voice && session?.opts.schaffner !== 'off') {
      loudLevels.clear();
      for (const m of gameNet.members()) {
        const lv = m.id === gameNet.selfId ? voice.micLevel() : voice.hasPeer(m.id) ? voice.peerLevel(m.id) : 0;
        loudLevels.set(m.id, lv);
      }
      const caught = loud.feed(loudLevels, dt, t);
      if (caught) {
        gameNet.send('sf:call', { id: caught });
        callSchaffner(caught);
      }
    }
    micHud?.update(pause.isOpen || (!session && voice?.micState !== 'on'));
    ambience?.update(t, world.train.kmh, world.power);
    voice?.update(world.camera, (id) => {
      const seat = idToSeat.get(id);
      return seat === undefined ? null : players.headPos(seat, voicePos);
    });
    if (!pipeline) return;
    gpuTimer?.poll();
    gpuTimer?.begin();
    pipeline.render();
    const gpuCell = gpuTimer?.end() ?? null;
    if (trace?.active) {
      const dir = world.camera.getWorldDirection(traceDir);
      trace.frame(dt, players.look.yaw, players.me.yaw, Math.atan2(dir.x, dir.z));
    }
    if (benchPanel) {
      // What was going on, so a stutter in the log can be matched to its cause.
      const tags: string[] = [];
      if (world.power < 0.98) tags.push('Stromausfall');
      if (world.lighting.passing) tags.push('Gegenzug');
      if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) tags.push('Durchsage');
      if (!document.pointerLockElement) tags.push('Maus frei');
      // Heap shrank since the last frame: a garbage collection ran in or just before this frame.
      const freedMb = heap?.sample() ?? 0;
      if (heap?.precise && freedMb > 0) tags.push('GC');
      benchPanel.update({ ms: Math.max(0.1, rawMs), work: performance.now() - workStart, calls: pipeline.renderer.info.render.calls, render: pipeline.renderSize, tags, gpu: gpuCell });
    }
    if (now - lastStat > 400) {
      lastStat = now;
      const info = pipeline.renderer.info.render;
      panel.showStats({ calls: info.calls, tris: info.triangles, fps, t, seed: clock.seed, power: world.power });
    }
  }
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Hook for Playwright checks; not shipped in the production bundle.
    Object.assign(window, { __hyper: { world, panel, pipeline, clock, session, pause, voice, ambience, whoami, sags, callSchaffner } });
  }
}

/** Wire a joined room into the scene: roster -> seats, poses -> heads, host speed and blackouts. */
function connect(session: Session, world: World, panel: DebugPanel, pause: PauseMenu, code: string, onSeats: () => void): void {
  const players = world.players;
  const roomInfo = () =>
    pause.setRoom({
      code,
      role: session.role,
      rttMs: world.clock.rttMs,
      players: [...session.roster.values()].map((e) => ({ id: e.id, name: e.state.name, seat: e.seat, me: e.id === session.selfId, host: e.id === session.hostId })),
      opts: session.opts,
    });
  pause.onRoomOpts = (o) => session.setOpts(o);
  const roster = (includeMe: boolean) => {
    players.applyRoster([...session.roster.values()], session.mySeat, includeMe);
    panel.setNetRole(session.role);
    onSeats();
    roomInfo();
  };
  players.remotePose = (seat) => session.poseForSeat(seat);
  roster(true);
  // A fresh room starts with the host's slider speed; a joiner takes what the welcome said.
  if (session.role === 'host' && session.train.kmh === 0) session.setSpeed(panel.state.kmh, world.clock.now());
  world.train = session.train;
  panel.showTempo(session.train.kmh);
  if (session.blackoutAt !== null) world.forcedBlackoutAt = session.blackoutAt;
  session.listen({
    roster: () => roster(false),
    status: () => roster(false),
    train: (t) => {
      world.train = t;
      panel.showTempo(t.kmh);
    },
    blackout: (at) => (world.forcedBlackoutAt = at),
    opts: (o) => {
      getVoice()?.setRoomVoice(o.voice);
      applyOpts(o);
      roomInfo();
    },
  });
  applyOpts(session.opts);
  function applyOpts(o: RoomOpts): void {
    world.blackouts = o.blackouts;
  }
  setInterval(roomInfo, 2000);
}

// --- Reconnect and failure handling --------------------------------------------------------------

/**
 * Per tab and room: a token that survives a reload (sessionStorage), so the host gives you your
 * seat back. A new tab is a new person.
 */
function tabToken(code: string): string {
  const key = `ukhdk.token.${code}`;
  try {
    let t = sessionStorage.getItem(key);
    if (!t) sessionStorage.setItem(key, (t = Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) => n.toString(36)).join('')));
    return t;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function markInRoom(code: string): void {
  try {
    sessionStorage.setItem('ukhdk.inroom', code);
  } catch {
    // Without storage a reload just shows the menu with the code filled in.
  }
}

/** The room this tab was in before a reload, if the address still points there. */
function rejoinCode(): string | null {
  try {
    const code = sessionStorage.getItem('ukhdk.inroom');
    return code && location.hash.slice(1) === code ? code : null;
  } catch {
    return null;
  }
}

let problemEl: HTMLElement | null = null;
/** One calm notice in the middle for things that went wrong, with what to do about it. */
function showProblem(text: string, action?: string, onAction?: () => void): void {
  problemEl?.remove();
  const box = el('div', 'problem');
  box.setAttribute('role', 'alert');
  box.append(el('p', '', text));
  if (action && onAction) {
    const b = el('button', 'btn big', action);
    b.type = 'button';
    b.addEventListener('click', onAction);
    box.append(b);
  }
  document.body.append(box);
  problemEl = box;
}

function hideProblem(): void {
  problemEl?.remove();
  problemEl = null;
}

// Offline: say it, instead of letting heads freeze silently. Back online, the relays reconnect by themselves.
addEventListener('offline', () => showProblem('Keine Internetverbindung. Sobald sie zurück ist, verbindet sich der Raum von selbst neu.'));
addEventListener('online', hideProblem);

/**
 * Pointer lock with raw mouse counts. Without it, Chrome hands out movement after OS acceleration
 * and, at display scaling above 100 %, rounds small steps down to zero: slow pans did nothing until
 * a jerk. Browsers without raw input get the normal lock.
 */
function lockMouse(el: HTMLElement): void {
  const raw = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
  if (!raw) MouseTrace.lockMode = 'normal (Browser ohne Rohdaten-Option)';
  raw?.then(
    () => (MouseTrace.lockMode = 'roh (unadjustedMovement)'),
    (e: DOMException) => {
      MouseTrace.lockMode = `Rohdaten abgelehnt: ${e.name}`;
      if (e.name !== 'NotSupportedError') return;
      const plain = el.requestPointerLock() as Promise<void> | undefined;
      plain?.then(
        () => (MouseTrace.lockMode = 'normal (Rohdaten nicht unterstützt)'),
        (e2: DOMException) => (MouseTrace.lockMode = `fehlgeschlagen: ${e2.name}`),
      );
    },
  );
}

const traceDir = new THREE.Vector3();
