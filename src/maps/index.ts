import { BUERGERAMT } from './buergeramt';
import { DINER } from './diner';
import { HYPERTRAIN } from './hypertrain';
import { SPAETI } from './spaeti';
import type { MapDef, MapId } from './types';
import { WASCHSALON } from './waschsalon';
import { WG } from './wg';

/** Every playable map; the host picks one per room (RoomOpts.map). */
export const MAPS: Record<MapId, MapDef> = {
  hypertrain: HYPERTRAIN,
  waschsalon: WASCHSALON,
  buergeramt: BUERGERAMT,
  spaeti: SPAETI,
  wg: WG,
  diner: DINER,
};

export const mapDef = (id: MapId): MapDef => MAPS[id] ?? MAPS.hypertrain;

/** Maps in the picker's order. */
export const mapList = (): MapDef[] => Object.values(MAPS);
