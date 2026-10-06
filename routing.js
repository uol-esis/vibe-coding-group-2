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
const MAX_POINTS = 25;
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

// points: mindestens zwei Wegpunkte [{ lat, lng }, …] in Reihenfolge.
// Liefert Gesamtstrecke, Dauer, Geometrie und die einzelnen Teilstrecken.
async function getRoute(profile, points) {
  if (!PROFILES[profile]) throw new RoutingError("Unbekanntes Verkehrsmittel.", 400);
  if (points.length < 2) throw new RoutingError("Für eine Route braucht es mindestens zwei Punkte.", 400);
  if (points.length > MAX_POINTS) {
    throw new RoutingError(`Eine Route kann höchstens ${MAX_POINTS} Punkte haben.`, 400);
  }
  for (let i = 1; i < points.length; i++) {
    if (distanceKm(points[i - 1], points[i]) > MAX_DISTANCE_KM) {
      throw new RoutingError(
        points.length === 2
          ? `Dein Standort ist zu weit entfernt (mehr als ${MAX_DISTANCE_KM} km). Routen werden nur in der Umgebung berechnet.`
          : `Zwei aufeinanderfolgende Stationen liegen mehr als ${MAX_DISTANCE_KM} km auseinander.`,
        422
      );
    }
  }

  const round = (n) => n.toFixed(5);
  const key = `${profile}:${points.map((p) => `${round(p.lat)},${round(p.lng)}`).join(";")}`;
  if (cache.has(key)) return cache.get(key);

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${BASE_URL}/${PROFILES[profile]}/route/v1/driving/${coords}` +
    "?overview=full&geometries=geojson&alternatives=false&steps=false";

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20000)
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
    geometry: route.geometry, // GeoJSON LineString
    legs: (route.legs || []).map((leg) => ({ distance: leg.distance, duration: leg.duration }))
  };
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { getRoute, RoutingError, PROFILES, MAX_POINTS };
