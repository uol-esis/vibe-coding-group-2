// Routenberechnung über OSRM von FOSSGIS (routing.openstreetmap.de).
//
// Die Anfragen laufen über den Server: eindeutiger User-Agent, Zeitlimit und
// ein kleiner Cache, damit dieselbe Route nicht mehrfach berechnet wird.
// https://routing.openstreetmap.de/about.html

const BASE_URL = "https://routing.openstreetmap.de";
const USER_AGENT =
  process.env.ROUTING_USER_AGENT ||
  "StadtApp-Karlsruhe/1.0 (+https://github.com/uol-esis/vibe-coding-group-2)";

// Verkehrsmittel → OSRM-Instanz
const PROFILES = {
  foot: "routed-foot",
  bike: "routed-bike",
  car: "routed-car"
};

// Routen über sehr große Entfernungen sind für eine Stadt-App nicht sinnvoll
// und belasten den freien Dienst unnötig.
const MAX_DISTANCE_KM = 150;
const CACHE_SIZE = 200;
const cache = new Map();

class RoutingError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function getRoute(profile, from, to) {
  if (!PROFILES[profile]) throw new RoutingError("Unbekanntes Verkehrsmittel.", 400);
  if (distanceKm(from, to) > MAX_DISTANCE_KM) {
    throw new RoutingError(
      `Dein Standort ist zu weit entfernt (mehr als ${MAX_DISTANCE_KM} km). Routen werden nur in der Umgebung berechnet.`,
      422
    );
  }

  const round = (n) => n.toFixed(5);
  const key = `${profile}:${round(from.lat)},${round(from.lng)};${round(to.lat)},${round(to.lng)}`;
  if (cache.has(key)) return cache.get(key);

  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${BASE_URL}/${PROFILES[profile]}/route/v1/driving/${coords}` +
    "?overview=full&geometries=geojson&alternatives=false&steps=false";

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }

  if (data && (data.code === "NoRoute" || data.code === "NoSegment")) {
    throw new RoutingError("Für diese Strecke wurde keine Route gefunden.", 422);
  }
  if (!res.ok || !data || data.code !== "Ok" || !data.routes || !data.routes.length) {
    throw new Error(`OSRM antwortete mit ${res.status} ${data && data.code}`);
  }

  const route = data.routes[0];
  const result = {
    profile,
    distance: route.distance, // Meter
    duration: route.duration, // Sekunden
    geometry: route.geometry // GeoJSON LineString
  };
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { getRoute, RoutingError, PROFILES };
