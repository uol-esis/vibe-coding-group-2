const express = require("express");

const app = express();
app.set("view engine", "ejs");

// Stadt-Konfiguration: Mittelpunkt der Karte ist das Karlsruher Schloss,
// von dem aus die Straßen fächerförmig verlaufen.
const city = {
  name: "Karlsruhe",
  center: [49.0094, 8.4044],
  zoom: 14
};

app.get("/", (req, res) => {
  res.render("index", {
    title: `StadtApp ${city.name}`,
    city
  });
});

app.listen(3000, "0.0.0.0", () => {
  console.log(`Server läuft auf Port 3000`);
});
