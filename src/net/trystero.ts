import { joinRoom, selfId, type MessageAction } from 'trystero';
import { NET } from '../config';
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
      void room.addStream(stream, to ? { target: to } : undefined);
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
