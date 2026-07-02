import type { Aircraft, AircraftRoute } from "@/types";
import { haversineM } from "@/geofence/geometry";

const M_PER_NM = 1852;
// Below this altitude an airliner is departing or arriving, so it should be near
// one of its route's airports. Above it we're cruising and can't verify.
const LOW_ALT_FT = 12000;
const NEAR_NM = 60; // "near an airport" tolerance (generous, to avoid false flags)

export interface RouteAssessment {
  plausible: boolean;
  note: string | null;
}

/**
 * Sanity-check a callsign-derived route against the aircraft's live position.
 *
 * adsbdb routes are keyed on the (airline-reused) flight-number callsign, so the
 * origin can be stale — e.g. an easyJet flight departing Bristol whose callsign
 * is on file as Gatwick→Málaga. When an aircraft is low/on-ground (departing or
 * arriving) yet far from BOTH airports on its stated route, that route almost
 * certainly isn't today's actual sector, so we flag it and drop the map overlay.
 * Cruise altitudes are left unverified (treated as plausible).
 */
export function assessRoute(a: Aircraft, route: AircraftRoute | null): RouteAssessment {
  const o = route?.origin;
  const d = route?.destination;
  if (
    a.lat == null ||
    a.lon == null ||
    o?.lat == null ||
    o?.lon == null ||
    d?.lat == null ||
    d?.lon == null
  ) {
    return { plausible: true, note: null }; // not enough data to judge
  }
  const low = a.on_ground || (a.alt_baro != null && a.alt_baro < LOW_ALT_FT);
  if (!low) return { plausible: true, note: null }; // en route — unverifiable from here

  const pos: [number, number] = [a.lon, a.lat];
  const dOrigin = haversineM(pos, [o.lon, o.lat]) / M_PER_NM;
  const dDest = haversineM(pos, [d.lon, d.lat]) / M_PER_NM;
  const nearest = Math.min(dOrigin, dDest);
  if (nearest <= NEAR_NM) return { plausible: true, note: null };

  return {
    plausible: false,
    note: `Live position is ${Math.round(
      nearest,
    )} nm from the nearest airport on this route — likely a reused or outdated callsign, not today's actual flight.`,
  };
}
