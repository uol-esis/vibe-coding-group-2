// Rückwärts-Geokodierung (Koordinaten → Adresse) über OpenStreetMap Nominatim.
//
// Die Anfragen laufen über den Server, damit wir die Nutzungsregeln von
// Nominatim einhalten: eindeutiger User-Agent, höchstens eine Anfrage pro
// Sekunde und Zwischenspeichern bereits abgefragter Orte.
// https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "StadtApp-Karlsruhe/1.0 (+https://github.com/uol-esis/vibe-coding-group-2)";
const MIN_INTERVAL_MS = 1100;
const CACHE_SIZE = 500;

const cache = new Map();
let queue = Promise.resolve();
let lastRequest = 0;

function formatAddress(result) {
  const a = result.address || {};
  const streetName =
    a.road || a.pedestrian || a.footway || a.cycleway || a.path || a.square || a.place;
  const street = [streetName, a.house_number].filter(Boolean).join(" ");
  const place = [a.postcode, a.city || a.town || a.village || a.municipality]
    .filter(Boolean)
    .join(" ");
  const first = street || result.name || a.suburb || a.city_district;
  const formatted = [first, place].filter(Boolean).join(", ");
  return formatted || result.display_name || null;
}

async function request(lat, lng) {
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();

  const url = new URL(NOMINATIM_URL);
  url.search = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "de"
  });

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`Nominatim antwortete mit ${res.status}`);
  const result = await res.json();
  if (result.error) return null; // z. B. „Unable to geocode“ mitten im Wald
  return formatAddress(result);
}

function reverseGeocode(lat, lng) {
  // Auf ca. 1 m runden, damit Klicks auf dieselbe Stelle den Cache treffen.
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  const run = queue.then(() => request(lat, lng));
  queue = run.catch(() => {});
  return run.then((address) => {
    cache.set(key, address);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return address;
  });
}

module.exports = { reverseGeocode, formatAddress };
