const path = require("path");
const crypto = require("crypto");
const express = require("express");
const store = require("./store");
const { reverseGeocode, searchPlaces } = require("./geocode");
const categories = require("./categories");

const app = express();
app.set("view engine", "ejs");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// Stadt-Konfiguration: Mittelpunkt der Karte ist das Karlsruher Schloss,
// von dem aus die Straßen fächerförmig verlaufen.
const city = {
  name: "Karlsruhe",
  center: [49.0094, 8.4044],
  zoom: 14,
  // Stadtgebiet für die Adresssuche: [[Süd, West], [Nord, Ost]]
  bounds: [[48.94, 8.27], [49.09, 8.55]]
};

// Wird beim Docker-Build gesetzt und hängt an CSS/JS-URLs, damit Browser
// nach einem Deployment die neuen Dateien laden.
const version = process.env.BUILD_VERSION || "dev";

app.get("/", (req, res) => {
  res.render("index", {
    title: `StadtApp ${city.name}`,
    city,
    version
  });
});

// ---------------------------------------------------------------------------
// POIs
// ---------------------------------------------------------------------------

const POI_FIELDS = [
  { key: "title", label: "Titel", max: 120, required: true },
  { key: "description", label: "Beschreibung", max: 2000, required: false },
  { key: "address", label: "Adresse", max: 300, required: false },
  { key: "author", label: "Autor:in", max: 80, required: true }
];

function validatePoi(body) {
  const input = body && typeof body === "object" ? body : {};
  const errors = [];
  const value = {};

  for (const field of POI_FIELDS) {
    const raw = input[field.key];
    if (raw != null && typeof raw !== "string") {
      errors.push(`${field.label} muss ein Text sein.`);
      continue;
    }
    const text = (raw || "").trim();
    if (field.required && !text) errors.push(`${field.label} fehlt.`);
    if (text.length > field.max) {
      errors.push(`${field.label} darf höchstens ${field.max} Zeichen lang sein.`);
    }
    value[field.key] = text;
  }

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (input.lat == null || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      input.lng == null || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    errors.push("Die Position ist ungültig.");
  }
  value.lat = lat;
  value.lng = lng;

  const category = typeof input.category === "string" ? input.category : "";
  if (!store.get().categories.some((c) => c.id === category)) {
    errors.push("Bitte wähle eine Kategorie.");
  }
  value.category = category;

  return { errors, value };
}

app.get("/api/categories", (req, res) => {
  res.json(store.get().categories);
});

app.get("/api/pois", (req, res) => {
  res.json(store.get().pois);
});

app.post("/api/pois", async (req, res) => {
  const { errors, value } = validatePoi(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });

  const now = new Date().toISOString();
  const poi = { id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
  await store.update((db) => db.pois.push(poi));
  res.status(201).json(poi);
});

app.put("/api/pois/:id", async (req, res) => {
  const { errors, value } = validatePoi(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });

  const updated = await store.update((db) => {
    const poi = db.pois.find((p) => p.id === req.params.id);
    if (!poi) return null;
    Object.assign(poi, value, { updatedAt: new Date().toISOString() });
    return poi;
  });
  if (!updated) return res.status(404).json({ error: "Diesen POI gibt es nicht mehr." });
  res.json(updated);
});

app.delete("/api/pois/:id", async (req, res) => {
  const removed = await store.update((db) => {
    const index = db.pois.findIndex((p) => p.id === req.params.id);
    if (index === -1) return false;
    db.pois.splice(index, 1);
    return true;
  });
  if (!removed) return res.status(404).json({ error: "Diesen POI gibt es nicht mehr." });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Adresse zu einer Kartenposition (OpenStreetMap Nominatim)
// ---------------------------------------------------------------------------

app.get("/api/geocode/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "Ungültige Koordinaten." });
  }
  try {
    res.json({ address: await reverseGeocode(lat, lng) });
  } catch (err) {
    console.warn("Nominatim-Anfrage fehlgeschlagen:", err.message);
    res.status(502).json({ error: "Die Adresse konnte nicht ermittelt werden." });
  }
});

app.get("/api/geocode/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 2 || query.length > 200) {
    return res.status(400).json({ error: "Bitte gib mindestens zwei Zeichen ein." });
  }
  try {
    res.json(await searchPlaces(query, city.bounds));
  } catch (err) {
    console.warn("Nominatim-Suche fehlgeschlagen:", err.message);
    res.status(502).json({ error: "Die Adresssuche ist gerade nicht erreichbar." });
  }
});

// ---------------------------------------------------------------------------
// Fehlerbehandlung für die API
// ---------------------------------------------------------------------------

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Unbekannte Anfrage." });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (!req.path.startsWith("/api")) return next(err);
  res.status(status).json({
    error: status >= 500 ? "Interner Serverfehler." : "Ungültige Anfrage."
  });
});

store
  .load({ migrate: categories.migrate })
  .then(() => {
    app.listen(3000, "0.0.0.0", () => {
      console.log(`Server läuft auf Port 3000`);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

module.exports = { validatePoi };
