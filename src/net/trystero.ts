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
      room.onPeerJoin = h;
    },
    onLeave(h) {
      room.onPeerLeave = h;
    },
    leave() {
      void room.leave();
    },
  };
}
