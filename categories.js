// Kategorien für POIs.
//
// Die Kategorien liegen wie alle Daten in der JSON-Datei (Schlüssel
// "categories"). Beim ersten Start mit dieser Version werden die
// Standardkategorien angelegt und vorhandene POIs ohne Kategorie anhand
// ihres Titels und ihrer Beschreibung einer passenden Kategorie zugeordnet.
//
// "icon" ist der Name eines Icons aus der Icon-Sammlung in public/app.js.

const DEFAULT_CATEGORY_ID = "sonstiges";

const DEFAULT_CATEGORIES = [
  { id: "sehenswuerdigkeit", name: "Sehenswürdigkeit", color: "#d1392b", icon: "landmark" },
  { id: "park", name: "Park & Natur", color: "#2f8f46", icon: "tree" },
  { id: "restaurant", name: "Restaurant", color: "#e06a12", icon: "utensils" },
  { id: "cafe", name: "Café", color: "#8a5a3b", icon: "cup" },
  { id: "kultur", name: "Kultur", color: "#7c4dcc", icon: "music" },
  { id: "bildung", name: "Bildung", color: "#2563eb", icon: "graduation" },
  { id: "einkaufen", name: "Einkaufen", color: "#d02f7a", icon: "bag" },
  { id: "sport", name: "Sport & Freizeit", color: "#0f8a80", icon: "ball" },
  { id: DEFAULT_CATEGORY_ID, name: "Sonstiges", color: "#64748b", icon: "star" }
];

// Stichwörter, um alte POIs ohne Kategorie sinnvoll einzuordnen.
// Die Reihenfolge entscheidet bei mehreren Treffern.
const KEYWORDS = [
  ["cafe", /caf[eé]|kaffee|coffee|bäckerei|konditorei|eisdiele/],
  ["restaurant", /restaurant|pizzeria|pizza|imbiss|döner|burger|bistro|gasthaus|gaststätte|brauerei|biergarten|kneipe|\bbar\b/],
  ["bildung", /schule|universität|\buni\b|hochschule|\bkit\b|bibliothek|bücherei|campus|institut|\bkita\b|kindergarten/],
  ["kultur", /museum|theater|kino|galerie|\boper\b|konzert|kunst|\bzkm\b|kultur|bühne|festival/],
  ["sport", /sport|stadion|schwimm|freibad|hallenbad|fitness|kletter|spielplatz|bolzplatz/],
  ["einkaufen", /einkauf|\bshop|supermarkt|wochenmarkt|\bladen\b|boutique|kaufhaus|galeria/],
  ["park", /park(?!haus|platz)|garten|\bwald|wiese|\bsee\b|natur|\bzoo\b|rhein|\balb\b/],
  ["sehenswuerdigkeit", /schloss|kirche|\bdom\b|pyramide|denkmal|turm|brunnen|\btor\b|rathaus|marktplatz|sehenswürdig|altstadt|historisch/]
];

function guessCategory(poi) {
  const text = `${poi.title || ""} ${poi.description || ""}`.toLowerCase();
  for (const [id, pattern] of KEYWORDS) {
    if (pattern.test(text)) return id;
  }
  return DEFAULT_CATEGORY_ID;
}

// Bringt geladene Daten auf den aktuellen Stand. Gibt true zurück, wenn
// etwas geändert wurde.
function migrate(db) {
  let changed = false;

  if (!Array.isArray(db.categories) || db.categories.length === 0) {
    db.categories = structuredClone(DEFAULT_CATEGORIES);
    changed = true;
  }

  const known = new Set(db.categories.map((c) => c.id));
  const fallback = known.has(DEFAULT_CATEGORY_ID) ? DEFAULT_CATEGORY_ID : db.categories[0].id;

  for (const poi of db.pois) {
    if (!poi.category || !known.has(poi.category)) {
      const guess = guessCategory(poi);
      poi.category = known.has(guess) ? guess : fallback;
      changed = true;
    }
  }

  return changed;
}

module.exports = { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ID, guessCategory, migrate };
