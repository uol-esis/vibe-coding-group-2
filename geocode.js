// Geokodierung über OpenStreetMap Nominatim:
//  - reverseGeocode: Koordinaten → Adresse (Vorausfüllen im POI-Formular)
//  - searchPlaces:   Suchtext → Adressen und Orte in der Stadt (Suche)
//
// Die Anfragen laufen über den Server, damit wir die Nutzungsregeln von
// Nominatim einhalten: eindeutiger User-Agent, höchstens eine Anfrage pro
// Sekunde, Zwischenspeichern von Ergebnissen und keine Autovervollständigung
// (gesucht wird erst, wenn jemand die Suche abschickt).
// https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM = "https://nominatim.openstreetmap.org";
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

async function request(path, params) {
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();

  const url = new URL(path, NOMINATIM);
  url.search = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    "accept-language": "de",
    ...params
  });

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error(`Nominatim antwortete mit ${res.status}`);
  return res.json();
}

// Führt Anfragen nacheinander aus (Drosselung) und speichert Ergebnisse.
function cached(key, load) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const run = queue.then(load);
  queue = run.catch(() => {});
  return run.then((value) => {
    cache.set(key, value);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return value;
  });
}

function reverseGeocode(lat, lng) {
  // Auf ca. 1 m runden, damit Klicks auf dieselbe Stelle den Cache treffen.
  const key = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`;
  return cached(key, async () => {
    const result = await request("/reverse", { lat: String(lat), lon: String(lng), zoom: "18" });
    if (result.error) return null; // z. B. „Unable to geocode“ mitten im Wald
    return formatAddress(result);
  });
}

// bounds: [[Süd, West], [Nord, Ost]] – die Suche bleibt auf die Stadt beschränkt.
function searchPlaces(query, bounds) {
  const [[south, west], [north, east]] = bounds;
  const key = `search:${query.toLowerCase()}`;
  return cached(key, async () => {
    const results = await request("/search", {
      q: query,
      limit: "6",
      countrycodes: "de",
      viewbox: `${west},${north},${east},${south}`,
      bounded: "1"
    });
    const seen = new Set();
    return results
      .map((r) => {
        const address = formatAddress(r);
        const name = r.name && r.name.trim();
        return {
          id: String(r.place_id),
          label: name || address || r.display_name,
          address: name && address && !address.startsWith(name) ? address : "",
          lat: Number(r.lat),
          lng: Number(r.lon)
        };
      })
      .filter((r) => {
        // Doppelte Treffer (z. B. Gebäude und Adresse) nur einmal zeigen.
        const k = `${r.label}|${r.address}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return Number.isFinite(r.lat) && Number.isFinite(r.lng);
      });
  });
}

module.exports = { reverseGeocode, searchPlaces, formatAddress };
