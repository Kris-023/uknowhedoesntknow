// Central tuning constants. Everything that defines the look or the feel lives here,
// so the group can tweak the train in one place instead of hunting through scene code.

/** Coach dimensions in metres. The coach stays at the origin; only the tunnel moves. */
export const COACH = {
  width: 3.0,
  length: 10.6,
  height: 2.5,
  wallX: 1.55,
  /** Ceiling side panels tilt by this angle (rad) to form the chamfered roof. */
  ceilingSlope: 0.364,
} as const;

/** Wall seats: 8 per side, 0.9 m apart. Seat index 4..5 on each side are the player seats. */
export const SEAT_Z = [-3.15, -2.25, -1.35, -0.45, 0.45, 1.35, 2.25, 3.15] as const;
export const SEAT_X = 1.17;

/** The four player seats (two facing pairs across the aisle). */
export const PLAYER_SEATS = [
  { side: -1, z: -0.45 },
  { side: -1, z: 0.45 },
  { side: 1, z: -0.45 },
  { side: 1, z: 0.45 },
] as const;

export const COLORS = {
  /** Near-black with a hint of blue, so the fog swallows the neighbouring coaches into night. */
  background: 0x010208,
  backgroundSight: 0x04101a,
  neon: 0x1c38f0,
  neonLight: 0x2a46ff,
  pale: 0xaab3bd,
  bulkhead: 0x9aa3ad,
  gangway: 0x24272d,
  seat: 0x8f8878,
  seatFoot: 0x6e695c,
  players: [0xffb224, 0x4fd8ff, 0xff5fa8, 0x9bff7a],
} as const;

/**
 * three.js r155+ uses physical light units. The prototype ran on r128 legacy lights, whose shaders
 * multiplied direct light by PI. Scaling here keeps the prototype's numbers readable.
 * Point lights get less: physical falloff (1/d^decay) explodes within 1 m, and the neon lights hang
 * 10 to 30 cm below the ceiling, which legacy falloff (capped at 1) never did.
 */
export const LIGHT_SCALE = Math.PI;
export const POINT_LIGHT_SCALE = 0.9;

/** One lighting look. Values are in prototype units (scaled by LIGHT_SCALE / POINT_LIGHT_SCALE). */
export interface LightPreset {
  hemi: number;
  ceilingWhite: number;
  neonBlue: number;
  window: number;
  /** Tube colour multiplier above 1 (HDR): only the tubes cross the bloom threshold, not the walls they light. */
  neonTubeHdr: number;
  /** Leuchtrahmen in the ceiling. */
  frameOpacity: number;
  exposure: number;
  /** Bloom luminance threshold in linear HDR; must sit above the brightest lit wall. */
  bloomThreshold: number;
}

/**
 * Lighting values every lighting consumer reads per frame. Night train: the neon strips carry
 * the room, everything else is a faint fill. All maps are tuned for exactly these values; the
 * player-facing brightness settings act on the output (exposure multiplier, canvas filter), not here.
 */
export const LIGHTS: Readonly<LightPreset> = {
  hemi: 0.04,
  ceilingWhite: 0.06,
  neonBlue: 0.9,
  window: 0.8,
  neonTubeHdr: 1.9,
  frameOpacity: 0.28,
  exposure: 0.85,
  bloomThreshold: 0.28,
};

export const RENDER = {
  maxPixelRatio: 2,
  /** MSAA on the scene target. The canvas itself has no AA: with post-processing only fullscreen quads reach it. */
  msaaSamples: 4,
  fogNear: 4,
  fogFar: 40,
} as const;

/** Real bloom (post-processing). The fake halos stay for the case it is switched off. */
export const BLOOM = {
  /**
   * Tuned for the half-size bloom below: its coarser mips spread more haze, so strength and radius
   * are lower than the full-size values they replace (0.8 / 0.45); same look within ~3/255 on average.
   */
  strength: 0.72,
  radius: 0.25,
  /** Bloom works at this fraction of the render size; glow is soft anyway, the full size cost ~10 % GPU. */
  resolutionScale: 0.5,
} as const;

export const SPEED = {
  maxKmh: 1200,
  defaultKmh: 1200,
  /** Real speed would turn streaks into a blur at 60 fps; this compresses it into readable motion. */
  visualScale: 0.12,
  /** Streak length grows with speed by this factor per scene-unit/s. */
  stretchPerUnit: 0.09,
} as const;

export const SHAKE = {
  defaultMm: 5,
} as const;

/**
 * Neighbouring coaches repeat in both directions; fog fades them out, which reads as infinity.
 * One period = coach (10.8 m incl. bulkheads) + gangway.
 */
export const TRAIN = {
  period: 11.6,
  gangwayLength: 0.8,
  /** A third copy (29–41 m away) changed 0.01 % of the pixels: the fog (far 40) swallows it. */
  neighboursPerSide: 2,
  /** Neighbour coaches up to this distance (per side) carry baked passengers; two crowd variants alternate. */
  crowdedPerSide: 2,
  crowdVariants: 2,
} as const;

/** Rare total power failure of the player coach only (neighbours and tunnel keep going). */
export const BLACKOUT = {
  /** Each window of this length has `chance` of containing one outage. */
  windowS: 37,
  chance: 0.45,
  minS: 1.2,
  maxS: 4.5,
} as const;

export const TUNNEL = {
  count: 380,
  /** The first streaks are evenly spaced rails along the window line (4 per row), the rest random debris. */
  regular: 96,
  /** Spans both directions, so streaks also pass the windows of the neighbouring coaches. */
  wrap: 96,
  front: 48,
  colors: [0x3a5bff, 0xbcd0ff, 0x6f8cff, 0xffb224, 0xbcd0ff],
  /** Visible streak core is this many times wider than the old box, because the texture fades at the edges. */
  coreWidth: 3,
  glowWidth: 7,
  glowOpacity: 0.1,
} as const;

export const CAMERA = {
  wagonPos: [0, 1.35, 4.95] as const,
  wagonLook: [0, 1.3, -3] as const,
  wagonFov: 62,
  seatFov: 74,
  mouseSensitivity: 0.0025,
  /** Local POV head follows the mouse almost instantly; others see it smoothed (network, M3). */
  povRate: 20,
  /** Right mouse in POV zooms to this share of the normal field of view (read cards on heads). */
  zoomFovFactor: 0.38,
  zoomRate: 10,
} as const;

/** Head and torso behaviour shared by all characters. */
export const HEAD = {
  /** Total yaw limit (head + torso); a bit beyond 90 degrees so both coach ends are visible from a seat. */
  maxYaw: 1.75,
  minPitch: -0.7,
  maxPitch: 0.9,
  /** Beyond this head yaw (rad) the torso starts to turn along ... */
  torsoFollowFrom: 0.52,
  /** ... by this share of the excess, capped, and with its own lag. */
  torsoShare: 0.45,
  torsoMax: 0.45,
  torsoRate: 2,
  /** Smoothing rate for the slider/demo, slow enough that the turn itself is the joke. */
  slowRate: 2.4,
} as const;

/**
 * Talking: the skull flips open by voice level. Fast attack and fast release, so it snaps open on
 * every syllable and shuts the moment someone stops.
 */
export const MOUTH = {
  /** Fully open angle in rad at level 1. */
  maxOpen: 0.6,
  /** Level curve exponent < 1: quiet speech already opens visibly. */
  curve: 0.6,
  attack: 35,
  release: 22,
} as const;

/** Halt countdown cycles with the shared clock so every peer shows the same number. */
export const HALT_CYCLE_S = 90;

export const TEXTURE_SEED = 7311;

/** Multiplayer over Trystero (WebRTC P2P, public Nostr relays only for the handshake). */
export const NET = {
  /** Namespace on the relays; the room code is the room inside it. */
  appId: 'uknowhedoesntknow',
  maxPlayers: 4,
  /**
   * Default seat fill order (the hypertrain's). Every map has its own, derived from where its seats
   * really are (`game/tableOrder.ts:fillOrder`) and handed to the session by main.ts; this is what
   * the session uses until then, and the seat set the per-map order must be a permutation of.
   */
  seatOrder: [0, 2, 1, 3] as readonly number[],
  /** Room code length (without the dash). 31 symbols, 8 chars ≈ 40 bits: the code is the only secret. */
  codeLength: 8,
  /** Head pose send rate; plus a keep-alive when the head is still. */
  poseHz: 20,
  poseKeepAliveMs: 1000,
  /** Smaller head changes are not worth a packet. */
  poseEpsilon: 0.002,
  /** Smoothing rate for remote heads; together with ~50 ms send interval stays well under 150 ms. */
  remoteRate: 18,
  /**
   * Someone who comes back within this long (reload, drop, other browser) gets their seat and their
   * place in a running round back. Long enough for a router restart or a fetched charger.
   */
  rejoinMs: 30 * 60_000,
  /** How long a "play on without them" request waits for the host to notice they're gone, too. */
  dropWaitMs: 30_000,
  /** Joiner repeats its hello until a host answers (host may still be connecting). */
  helloRetryMs: 2000,
  /**
   * A client that has heard nothing from its host this long (no pong, roster, train ...) takes the
   * host for gone and elects a new one. The last resort that keeps a room from staying host-less
   * after any race; pings go every `pingSlowMs`, so a working host is heard well within this.
   */
  hostSilentMs: 6000,
  /** The host who hands the role over stays host this long if the new host never confirms (it left, or never heard). */
  handoverWaitMs: 5000,
  /** Quick pings right after joining for a good clock offset, then occasional ones. */
  pingFastMs: 250,
  pingFastCount: 8,
  pingSlowMs: 1000,
  /**
   * Without a host after this long, offer to reopen the room yourself. Nostr signaling alone can take
   * ~10 s, and taking over too early would split the room in two.
   */
  orphanMs: 20000,
} as const;

/** Voice chat: WebRTC audio mesh, positioned with Web Audio so voices come from the heads. */
export const VOICE = {
  /** Mic level window for the mouth: below `gateDb` the mouth stays shut, at `fullDb` it's wide open. */
  gateDb: -50,
  fullDb: -18,
  /** Panner: full volume up to refDistance (m), then inverse falloff. Seats are 0.9–2.4 m apart. */
  refDistance: 1.2,
  rolloff: 1,
  /**
   * Beyond `nearM` a voice gets duller (lowpass) and more echo (reverb send), fully at `farM`.
   * In the coach everyone is near; it kicks in when someone walks away or flies out.
   */
  nearM: 3,
  farM: 10,
  lowpassNearHz: 16000,
  lowpassFarHz: 900,
  wetNear: 0.06,
  wetFar: 0.65,
  /** Generated impulse response: length (s) and decay, a tiled tunnel rather than a cathedral. */
  reverbS: 1.6,
  reverbDecay: 3.2,
  /**
   * Voice activation ("Automatisch"): the gate opens at the threshold, stays open `vadHangMs` after the
   * last loud moment so word endings aren't cut, and the sent audio runs `vadLookaheadS` behind the
   * gate so the first syllable isn't swallowed either.
   */
  vadDefault: 0.5,
  vadHangMs: 450,
  vadLookaheadS: 0.05,
  vadPollMs: 15,
  /**
   * "Nur Mundbewegung": no audio goes out, only the mouth level (one byte, `lvl` message) at most
   * `mouthHz` times a second while it is above the threshold, plus a final 0. A level older than
   * `mouthStaleMs` counts as silence (lost packet, peer gone or switched mode).
   */
  mouthHz: 12,
  mouthStaleMs: 500,
  /**
   * Outgoing voice: a highpass takes out desk thumps and rumble, a limiter only catches shouts before
   * they clip (it starts above the Schaffner's level, so it doesn't hide shouting from him).
   * Opus starts around 32 kbit/s in browsers; 64 is clearly fuller and still nothing for a 4-way mesh.
   */
  highpassHz: 80,
  limiterDb: -6,
  bitrate: 64_000,
  /** Push-to-talk key (KeyboardEvent.code) and mute toggle. */
  pttKey: 'KeyV',
  muteKey: 'KeyM',
} as const;

/** Stops of line 7 as on the line display; the halt countdown cycles through them. */
export const STATIONS = ['Offenbach', 'Kaiserslautern', 'Oranienburg', 'Alt Schauerberg', 'KitKat', 'Kreuzberg', 'Alfteller', 'Gutach'] as const;

/** Oncoming train: a light sweeping along one window side, rare and hashed from the clock. */
export const ONCOMING = {
  windowS: 29,
  chance: 0.55,
  durationS: 1.5,
} as const;

/** Synthetic train sounds and announcements. */
export const AMBIENCE = {
  /**
   * Startup: sound stays muted until this many frames in a row came in under `stableFrameMs`
   * (or `maxHoldS` passed), then fades in. Covers the shader compile and world build hiccups.
   */
  stableFrames: 40,
  stableFrameMs: 40,
  maxHoldS: 8,
  /** Announcement this many seconds before the halt countdown reaches zero. */
  announceAt: 12,
  /** Only every n-th halt gets an announcement; every halt was too chatty over a long evening. */
  announceEveryHalts: 2,
  /** Gong level into the speaker chain. */
  gong: 0.2,
  /** "Ruhige Umgebung": the steady bed drops to this share; one-off noises stay as they are. */
  quietBed: 0.2,
} as const;

/** Mitreisende: 7 seated (seat index on a side), 3 standing in the back (z <= -2.5, out of the players' way). */
export const NPC_DEFS = [
  { seat: { side: -1, z: -3.15 }, act: 'phone' },
  { seat: { side: -1, z: -1.35 }, act: 'paper' },
  { seat: { side: -1, z: 2.25 }, act: 'beer' },
  { seat: { side: -1, z: -2.25 }, act: 'sleep' },
  { seat: { side: 1, z: -2.25 }, act: 'beer', can: true },
  { seat: { side: 1, z: 1.35 }, act: 'phone' },
  { seat: { side: 1, z: 2.25 }, act: 'paper' },
  { stand: { x: -0.4, z: -4.4, yaw: 0.25 }, act: 'phone' },
  { stand: { x: 0.5, z: -3.4, yaw: -0.6 }, act: 'beer' },
  { stand: { x: -0.45, z: -2.9, yaw: 0.35 }, act: 'paper' },
] as const;

/** Minigame "Wer bin ich?". Rules are open (F4); these are the first, simple ones. */
export const WHOAMI = {
  /** Points for solving, by order: first, second, third, rest. */
  points: [3, 2, 1, 1],
  /** A vote closes after this long with the votes that came in. */
  voteS: 20,
  /**
   * Absent player (reload, dropout): their turn passes after this long. They keep their place in the
   * round as long as their seat is held (NET.rejoinMs), unless the others play on without them.
   */
  absentPassS: 8,
  absentLeaveS: 30 * 60,
  /** Card image: longest side in px, JPEG quality. Kept in memory only, never uploaded. */
  cardPx: 512,
  cardQuality: 0.82,
  /** Largest card payload accepted from a peer (base64 data URL). */
  cardMaxChars: 600_000,
  /** Card above the head: size in metres (for the on-screen size); its bottom edge this high above the seat root. */
  cardSizeM: 0.62,
  cardY: 1.1,
} as const;

/**
 * The Schaffner: too loud for too long (measured by the host from everyone's audio) brings an
 * announcement and a point off.
 */
export const SCHAFFNER = {
  /** Mouth/meter level that counts as shouting. */
  loudLevel: 0.97,
  /** Seconds of shouting within `windowS` that trigger him. */
  loudS: 2.5,
  windowS: 5,
  /** He doesn't come again for the same person within this many seconds. */
  cooldownS: 30,
  penalty: 1,
  /** How long he stands next to you. */
  showS: 7,
  /**
   * His spoken call (and gong) never plays quieter than this announcement volume, even with
   * Durchsagen at 0 %: he is part of the game (the Punktabzug), so he is not switchable.
   */
  minVolume: 0.4,
} as const;

/** "Zug zurück": the host takes back a wrong collective decision (see src/game/undo.ts). */
export const UNDO = {
  /** Decisions kept per round; enough to fix a mistake noticed a little late, not to replay a round. */
  depth: 5,
  /**
   * A "Sag's anders" turn taken back resumes with the time it had left when the card was decided,
   * but at least this much, so a card decided in the last second isn't over again at once.
   */
  resumeMinS: 10,
} as const;

/** Rolling random looks and the procedural hair/beard materials. */
export const LOOKS = {
  /** Share of random looks with a joke face (gestreckt, länglich, Dorito). */
  jokeFaceChance: 0.12,
  /** Share of random men with some beard (style picked separately). */
  beardChance: 0.35,
  /** Relief of the hair textures; higher reads as coarser hair under the coach lights. */
  hairBump: 2.5,
  /** Stubble is a dotted decal over the jaw; at full opacity it reads as dirt. */
  stubbleOpacity: 0.85,
} as const;

/** Word cards shared by every word game: limits for submissions and what peers may send. */
export const WORDS = {
  maxChars: 40,
  maxTaboo: 8,
  /** Own list in the browser. */
  maxCustom: 500,
  /** Cards one player brings into a room. */
  maxShared: 300,
} as const;

/**
 * Own lists ("Eigene Listen"): named lists per kind in the browser; enabled ones travel to the room
 * when the deck "Eigene" is on. Limits keep both the storage and what a peer may send small.
 */
export const LISTS = {
  /** All kinds together. */
  maxLists: 40,
  maxNameChars: 32,
  /** Entries in one list (the old single word list allowed WORDS.maxCustom). */
  maxItems: WORDS.maxCustom,
  /** Longest entry per kind in characters. Word cards keep WORDS.maxChars; a category has to fit a board. */
  maxChars: { words: WORDS.maxChars, zeig: 100, fragen: 80, kategorien: 24 },
  /** What one player brings into a room per kind, all enabled lists together. */
  maxShared: { words: WORDS.maxShared, zeig: 150, fragen: 150, kategorien: 60 },
} as const;

/** "Sag's anders": explain a word without its forbidden words. */
export const SAGS = {
  /** Seconds per turn (the room picks from ROOM.turnChoices). */
  turnS: 60,
  /** Every player explains this many turns per round. */
  turnsEach: 2,
  /** Free for all (2–3 players): the one who guessed and the one who explained. */
  ffaGuesser: 2,
  ffaExplainer: 1,
  /** Teams (4 players): a guessed word for the explaining team, a foul for the other one. */
  teamGot: 1,
  teamFoul: 1,
  /** Free for all: on a foul the word's points are taken back and the explainer loses this much. */
  ffaFoul: 1,
  /** After each word its card is shown to all; this long anyone may still call a foul (free for all). */
  challengeS: 8,
  /** Absent explainer (reload, dropout): the turn ends after this long; their place is kept like in WHOAMI. */
  absentPassS: 8,
  absentLeaveS: 30 * 60,
} as const;

/** "Gleich gedacht": everyone writes a word until all have written the same one. */
export const GLEICH = {
  /** Seconds to write and lock a word. */
  writeS: 45,
  /** A "Zählt als gleich?" vote closes after this long with the votes that came in. */
  voteS: 15,
  /** After the words are shown the next try starts when all are ready, or after this long. */
  revealS: 25,
  /** After a lost vote the others get at least this long to read before the next try. */
  afterVoteS: 8,
  /** Host waits this long for the revealed words of players who locked one before it judges with what it has. */
  collectS: 4,
  maxTries: 10,
  /** Points for everyone in the round by the try it was solved in. */
  points: [10, 8, 7, 6, 5, 4, 3, 2, 2, 1],
  /** Longest word in code points. */
  maxWordLen: 24,
  /** Absent player: how long the others' round keeps their place (like WHOAMI). */
  absentLeaveS: 30 * 60,
  /** Word board image over a head, in canvas pixels: wide, because words are wider than pictures. */
  boardPx: { w: 384, h: 240 },
} as const;

/** Picking someone by looking at them ("Zeig drauf", the vote in "Ahnungslos"). */
export const GAZE = {
  /** Largest angle between the view direction and a head that still counts as looking at them. */
  maxAngleDeg: 18,
  /** The current pick wins within this many extra degrees, so it doesn't flicker between two close heads. */
  stickDeg: 3,
  /** While the pick changes it goes to the host at most this often. */
  sendMs: 120,
} as const;

/** "Zeig drauf": "Wer würde am ehesten …?", everyone looks at their choice at the same time. */
export const ZEIG = {
  /** Questions per round. */
  questions: 8,
  /** Seconds to look at someone; whoever you look at when it runs out is your pick. */
  lookS: 10,
  /** The result stays this long unless everyone pressed "Weiter" before. */
  revealS: 8,
  /** For everyone whose pick was (one of) the most picked. */
  majorityPoints: 1,
  /** A "majority" of one isn't agreement: below this many votes for the top nobody scores. */
  minAgree: 2,
  /** With two people everyone can only pick the other one. */
  minPlayers: 3,
  /** A new host gets the picks again from the clients; the countdown waits at least this long for them. */
  takeoverS: 3,
  /** Absent player: how long the others' round keeps their place (like WHOAMI). */
  absentLeaveS: 30 * 60,
} as const;

/** "Ahnungslos": everyone knows the word but one; a clue word each, then find the one without a clue. */
export const AHNUNG = {
  /** Clue laps around the table. */
  laps: 2,
  /** Seconds per clue; then the turn is skipped. */
  clueS: 30,
  voteS: 15,
  /** Seconds for the caught player to guess the word. */
  guessS: 20,
  /** Not caught (wrong person or a tie). */
  escapePoints: 3,
  /** Caught, but guessed the word. */
  guessPoints: 2,
  /** Caught and guessed wrong: for each of the others. */
  catchPoints: 1,
  /** Longest clue and guess in code points; a guess may be as long as a word card. */
  maxClueLen: 24,
  maxGuessLen: 40,
  minPlayers: 3,
  /** Absent player on turn: their clue is skipped after this long. */
  absentPassS: 8,
  absentLeaveS: 30 * 60,
  /** A client without its word asks the host again this often. */
  askAgainMs: 2000,
} as const;

/** "Stadt, Land, Fluss": one letter, a few categories; written, or found as pictures. */
export const SLF = {
  /** Letters the host draws from: Q, X and Y leave too many categories empty. */
  letters: 'ABCDEFGHIJKLMNOPRSTUVWZ',
  /**
   * The preset "Klassisch" starts with these (the game's name) and fills up from the public fallback.
   * They are no longer forced into every round: the table picks its categories before writing. The
   * category lists themselves are content (src/words/content.ts): sealed in the vault, the classic
   * set in the public fallback.
   */
  fixed: ['Stadt', 'Land', 'Fluss'],
  /** Categories a round starts with by mode (a fresh draw, "Klassisch", "Zufall"). */
  count: { text: 6, bild: 3 },
  /**
   * The step "Kategorien" before writing. Bounds of the list per mode (pictures take longer to find,
   * so fewer); pending proposals per player, so nobody floods the host. A category may be as long
   * as the sealed content allows (the seal script's limit), typed ones as long as an own-list entry.
   */
  pick: {
    min: { text: 4, bild: 2 },
    max: { text: 10, bild: 5 },
    maxProposals: 3,
    maxLen: 40,
    maxTyped: LISTS.maxChars.kategorien,
  },
  /** Seconds to write all categories; a "Stopp!" leaves the others `stopS` more. */
  writeS: 180,
  stopS: 10,
  /** Picture rounds: one timer for all categories, so everyone hunts in their own order; a stop leaves more time (searching takes longer than typing). */
  imageS: 90,
  imageStopS: 20,
  /** Host waits this long for the commitments of players who hadn't stopped, then this long for the reveals (pictures are bigger). */
  lockS: 3,
  collectS: 5,
  collectImageS: 12,
  /** A flag ("ungültig", "gleich wie") is a quick vote of the others. */
  voteS: 15,
  /** A category's answers stay this long unless everyone pressed "Weiter"; a vote extends it by afterVoteS. */
  rateS: 45,
  afterVoteS: 6,
  /** Picture rounds: time to judge the pictures of one category, then to look at the result. */
  imageVoteS: 30,
  showS: 15,
  /** Classic points: unique valid answer, same answer as someone else, the only valid answer of the category. */
  points: { unique: 10, same: 5, only: 20 },
  /** Picture rounds: each picture that counts, plus a bonus for the best one (ties: all of them). */
  imagePoints: 10,
  bestBonus: 5,
  /** Longest answer and caption in code points. */
  maxAnswerLen: 32,
  maxCaptionLen: 24,
  absentLeaveS: 30 * 60,
} as const;

/** Room settings dialog: the choices on offer. */
export const ROOM = {
  voteChoices: [10, 20, 30, 45],
  voteDefault: WHOAMI.voteS,
  turnChoices: [45, 60, 90, 120],
} as const;
