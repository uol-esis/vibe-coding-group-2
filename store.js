// Einfache JSON-Datenablage für die gesamte App.
//
// Alle Daten liegen in einer einzigen Datei (standardmäßig data/db.json).
// Im Docker-Container ist /app/data ein Volume, damit die Daten Neustarts
// und neue Deployments überstehen. Die Daten werden beim Start einmal
// geladen, im Speicher gehalten und nach jeder Änderung atomar
// (temporäre Datei + Umbenennen) zurückgeschrieben.

const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// Grundstruktur der Datei. Neue Datenarten der App bekommen hier einfach
// einen weiteren Schlüssel; fehlende Schlüssel werden beim Laden ergänzt.
const DEFAULTS = {
  categories: [],
  pois: []
};

let data = null;
let writeQueue = Promise.resolve();

// migrate(db) kann die geladenen Daten auf den aktuellen Stand bringen
// (z. B. neue Felder ergänzen); danach wird die Datei gespeichert.
async function load({ migrate } = {}) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let stored = {};
  try {
    stored = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      // Lieber abbrechen als eine beschädigte Datei zu überschreiben.
      throw new Error(`Datendatei ${DB_FILE} konnte nicht gelesen werden: ${err.message}`);
    }
  }
  data = { ...structuredClone(DEFAULTS), ...stored };
  if (migrate && migrate(data) && Object.keys(stored).length > 0) {
    // Vor einer Datenmigration eine Sicherungskopie der alten Datei anlegen.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.copyFile(DB_FILE, path.join(DATA_DIR, `db.backup-${stamp}.json`));
  }
  await persist();
  console.log(
    `Daten geladen aus ${DB_FILE} (${data.pois.length} POIs, ${data.categories.length} Kategorien)`
  );
}

async function persist() {
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, DB_FILE);
}

function get() {
  if (!data) throw new Error("Datenablage ist noch nicht geladen");
  return data;
}

// Führt eine Änderung aus und speichert danach. Änderungen laufen
// nacheinander, damit sich gleichzeitige Schreibvorgänge nicht überholen.
function update(mutator) {
  const run = writeQueue.then(async () => {
    const result = mutator(get());
    await persist();
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
}

module.exports = { load, get, update, DB_FILE };
