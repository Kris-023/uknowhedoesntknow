import { joinRoom, selfId, type MessageAction } from 'trystero';
import { NET, VOICE } from '../config';
import type { Handler, Transport } from './transport';

/**
 * Trystero room as a Transport. Signaling goes over public Nostr relays, everything after that is
 * direct WebRTC between the browsers. The room code doubles as password, so the relays only ever see
 * encrypted session descriptions.
 */
export function trysteroTransport(code: string, onError: (msg: string) => void): Transport {
  const room = joinRoom({ appId: NET.appId, password: code }, code, {
    onJoinError: (d) => onError(String(d.error)),
  });
  // Trystero has one handler per event; session and voice both need joins and leaves.
  const joins: ((id: string) => void)[] = [];
  const leaves: ((id: string) => void)[] = [];
  room.onPeerJoin = (id) => joins.forEach((h) => h(id));
  room.onPeerLeave = (id) => leaves.forEach((h) => h(id));
  const actions = new Map<string, MessageAction>();
  const action = (type: string): MessageAction => {
    let a = actions.get(type);
    if (!a) actions.set(type, (a = room.makeAction(type)));
    return a;
  };
  return {
    selfId,
    send(type, data, to) {
      void action(type).send(data as never, to ? { target: to } : undefined);
    },
    on(type, h: Handler) {
      action(type).onMessage = (data, meta) => h(data, meta.peerId);
    },
    onJoin(h) {
      joins.push(h);
      // Peers already present are replayed, like Trystero does for its own handler.
      for (const id of Object.keys(room.getPeers())) h(id);
    },
    onLeave(h) {
      leaves.push(h);
    },
    addStream(stream, to) {
      const added = room.addStream(stream, to ? { target: to } : undefined);
      // Chrome fills in the encodings only once negotiation is under way, so tune once added and again a bit later.
      void Promise.allSettled(added).then(() => tuneVoice(room.getPeers(), stream, to));
      setTimeout(() => tuneVoice(room.getPeers(), stream, to), 3000);
    },
    removeStream(stream) {
      room.removeStream(stream);
    },
    onStream(h) {
      room.onPeerStream = (stream, peerId) => h(stream, peerId);
    },
    leave() {
      void room.leave();
    },
  };
}

/** More bitrate and network priority for our voice than the browser default. */
function tuneVoice(peers: Record<string, RTCPeerConnection>, stream: MediaStream, to?: string): void {
  const tracks = new Set<MediaStreamTrack>(stream.getAudioTracks());
  for (const [id, pc] of Object.entries(peers)) {
    if (to && id !== to) continue;
    for (const sender of pc.getSenders()) {
      if (!sender.track || !tracks.has(sender.track)) continue;
      const p = sender.getParameters();
      const e = p.encodings?.[0];
      if (!e || e.maxBitrate === VOICE.bitrate) continue;
      e.maxBitrate = VOICE.bitrate;
      e.networkPriority = 'high';
      void sender.setParameters(p).catch(() => {});
    }
  }
}
