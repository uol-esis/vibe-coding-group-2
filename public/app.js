"use strict";

(() => {
  // -------------------------------------------------------------------------
  // Karte
  // -------------------------------------------------------------------------

  const city = window.CITY;

  const map = L.map("map", { center: city.center, zoom: city.zoom });

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
  }).addTo(map);

  L.control.scale({ imperial: false }).addTo(map);

  // -------------------------------------------------------------------------
  // Elemente & Zustand
  // -------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const btnNew = $("btn-new-poi");
  const btnNewLabel = btnNew.querySelector(".btn-label");
  const btnFilter = $("btn-filter");
  const filterDot = $("filter-dot");
  const filterPanel = $("filter-panel");
  const filterList = $("filter-list");
  const pickHint = $("pick-hint");
  const panel = $("poi-panel");
  const form = $("poi-form");
  const panelTitle = $("poi-panel-title");
  const categoryField = $("category-field");
  const categoryOptions = $("category-options");
  const formError = $("form-error");
  const addressHint = $("address-hint");
  const btnSave = $("btn-save");
  const toastEl = $("toast");
  const searchForm = $("search");
  const searchInput = $("search-input");
  const searchResults = $("search-results");
  const searchClose = $("search-close");
  const btnSearch = $("btn-search");
  const btnList = $("btn-list");
  const listPanel = $("list-panel");
  const listClose = $("list-close");
  const poiList = $("poi-list");
  const listCount = $("list-count");
  const listHint = $("list-hint");
  const listEmpty = $("list-empty");

  const AUTHOR_KEY = "stadtapp.author";
  const HIDDEN_KEY = "stadtapp.hiddenCategories";
  const ADDRESS_PLACEHOLDER = "Straße Hausnummer, PLZ Ort";
  const FALLBACK_CATEGORY = "sonstiges";

  const categories = new Map(); // id → Kategorie (Reihenfolge wie vom Server)
  const pois = new Map(); // id → POI
  const markers = new Map(); // id → Leaflet-Marker
  const hiddenCategories = new Set(readJson(HIDDEN_KEY, []));

  let picking = false; // wartet auf Klick in die Karte
  let editing = null; // { id: string|null, draft: Marker } während das Formular offen ist
  let addressTouched = false; // Adresse wurde von Hand geändert
  let geocodeToken = 0; // verwirft veraltete Adressantworten
  let listOpen = false; // Seitenleiste mit der Liste ist offen
  let activePoiId = null; // POI, dessen Popup gerade offen ist
  let searchMarker = null; // Marker für ein gewähltes Adress-Suchergebnis
  let addressSearch = { query: "", status: "idle", results: [], error: "" };
  let searchOptions = []; // auswählbare Einträge in der Ergebnisliste
  let activeOption = -1; // per Tastatur markierter Eintrag

  const mobileQuery = window.matchMedia("(max-width: 640px)");
  const isMobile = () => mobileQuery.matches;

  // -------------------------------------------------------------------------
  // Icons
  // -------------------------------------------------------------------------

  // Icons für Kategorien (24×24, Strichzeichnung). Der Name steht in der
  // Kategorie unter "icon".
  const CATEGORY_ICONS = {
    landmark: '<path d="M3 21h18M5 21v-9M9.7 21v-9M14.3 21v-9M19 21v-9M3 9.5 12 4l9 5.5z"/>',
    tree: '<path d="M12 21v-4M12 3 6.5 11H9l-3.5 6h13L15 11h2.5z"/>',
    utensils: '<path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2.2 1.3-3.5 4-3.5 7.5V14H17"/>',
    cup: '<path d="M4 9h12v4.5a5.5 5.5 0 0 1-5.5 5.5h-1A5.5 5.5 0 0 1 4 13.5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5V6M12 3.5V6"/>',
    music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    graduation: '<path d="M2 9.5 12 5l10 4.5-10 4.5zM6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9.5V15"/>',
    bag: '<path d="M5 8h14l-1.2 13H6.2zM9 10V6.5a3 3 0 0 1 6 0V10"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>'
  };

  const UI_ICONS = {
    place: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>'
  };

  const PIN_PATH =
    "M15 1.5C7.5 1.5 1.5 7.4 1.5 14.8c0 9.6 11.6 22 12.4 22.9a1.5 1.5 0 0 0 2.2 0" +
    "c.8-.9 12.4-13.3 12.4-22.9C28.5 7.4 22.5 1.5 15 1.5z";

  function safeColor(color) {
    return /^#[0-9a-f]{3,8}$/i.test(color || "") ? color : "#64748b";
  }

  function categoryIconMarkup(category) {
    return CATEGORY_ICONS[category && category.icon] || CATEGORY_ICONS.star;
  }

  const pinCache = new Map();
  function pinIcon(category, draft) {
    const key = `${category ? category.id : "-"}|${draft}`;
    if (!pinCache.has(key)) {
      const color = category ? safeColor(category.color) : "#1f2328";
      const inner = category
        ? `<svg class="pin-icon" x="7" y="6.5" width="16" height="16" viewBox="0 0 24 24">${categoryIconMarkup(category)}</svg>`
        : '<circle class="pin-dot" cx="15" cy="14.5" r="5"/>';
      pinCache.set(key, L.divIcon({
        className: draft ? "poi-pin is-draft" : "poi-pin",
        html: `<svg viewBox="0 0 30 40" aria-hidden="true"><path class="pin-body" style="fill:${color}" d="${PIN_PATH}"/>${inner}</svg>`,
        iconSize: [30, 40],
        iconAnchor: [15, 38],
        popupAnchor: [0, -36]
      }));
    }
    return pinCache.get(key);
  }

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------

  // Baut DOM-Elemente; Texte werden immer als Text (nie als HTML) eingesetzt.
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) {
      if (child != null && child !== false) node.append(child);
    }
    return node;
  }

  function fromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.firstElementChild;
  }

  function uiIcon(name) {
    return fromHtml(UI_ICONS[name]);
  }

  // Rundes, farbiges Kategorie-Icon
  function categoryBadgeIcon(category) {
    const span = el("span", { class: "cat-icon", style: `--cat:${safeColor(category.color)}`, "aria-hidden": "true" });
    span.innerHTML = `<svg viewBox="0 0 24 24">${categoryIconMarkup(category)}</svg>`;
    return span;
  }

  function categoryOf(poi) {
    return categories.get(poi.category) || categories.get(FALLBACK_CATEGORY) || null;
  }

  // Für Buttons in Popups: Aktionen, die das Popup schließen, erst nach dem
  // Klick ausführen. Sonst hält Leaflet den Klick für einen Klick in die Karte.
  function later(fn) {
    return () => setTimeout(fn, 0);
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* z. B. privater Modus */ }
  }

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new Error("Keine Verbindung zum Server.");
    }
    let data = null;
    if (res.status !== 204) {
      try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Fehler ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle("is-error", isError);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, isError ? 5000 : 3000);
  }

  // -------------------------------------------------------------------------
  // Marker & Popups
  // -------------------------------------------------------------------------

  function buildPopup(poi) {
    const root = el("div", { class: "poi-popup" });
    const category = categoryOf(poi);
    if (category) {
      root.append(el("span", { class: "cat-badge", style: `--cat:${safeColor(category.color)}` },
        categoryBadgeIcon(category), category.name));
    }
    root.append(el("h3", null, poi.title));
    if (poi.description) root.append(el("p", { class: "desc" }, poi.description));
    if (poi.address) root.append(el("p", { class: "meta" }, uiIcon("place"), el("span", null, poi.address)));
    root.append(el("p", { class: "meta" }, uiIcon("user"), el("span", null, `von ${poi.author}`)));

    const actions = el("div", { class: "actions" },
      el("button", { type: "button", class: "btn btn-sm", onclick: later(() => startEdit(poi.id)) }, "Bearbeiten"),
      el("button", { type: "button", class: "btn btn-sm", onclick: () => showConfirm(true) }, "Löschen")
    );

    // Sicherheitsabfrage direkt im Popup. Die Buttons werden nur ein- und
    // ausgeblendet, nicht ersetzt: Leaflet schließt das Popup sonst, weil der
    // geklickte Button nicht mehr im Popup hängt.
    const btnConfirm = el("button", {
      type: "button",
      class: "btn btn-sm btn-danger",
      onclick: () => deletePoi(poi.id, btnConfirm)
    }, "Ja, löschen");
    const btnCancel = el("button", { type: "button", class: "btn btn-sm", onclick: () => showConfirm(false) }, "Abbrechen");
    const confirmBox = el("div", { class: "confirm", hidden: true },
      el("p", null, "Diesen POI wirklich löschen?"),
      el("div", { class: "actions" }, btnConfirm, btnCancel)
    );
    root.append(routeButton({ lat: poi.lat, lng: poi.lng, label: poi.title }), actions, confirmBox);

    function showConfirm(show) {
      actions.hidden = show;
      confirmBox.hidden = !show;
      if (show) btnConfirm.focus();
    }

    return root;
  }

  // Zeigt oder versteckt einen Marker je nach Filter und Bearbeitungszustand.
  function syncMarker(id) {
    const marker = markers.get(id);
    const poi = pois.get(id);
    if (!marker || !poi) return;
    const show = !hiddenCategories.has(poi.category) && !(editing && editing.id === id);
    if (show && !map.hasLayer(marker)) marker.addTo(map);
    if (!show && map.hasLayer(marker)) marker.remove();
    const element = marker.getElement();
    if (element) element.setAttribute("title", poi.title);
  }

  function upsertPoi(poi) {
    pois.set(poi.id, poi);
    let marker = markers.get(poi.id);
    if (marker) {
      marker.setLatLng([poi.lat, poi.lng]);
      marker.setIcon(pinIcon(categoryOf(poi), false));
    } else {
      marker = L.marker([poi.lat, poi.lng], { icon: pinIcon(categoryOf(poi), false), riseOnHover: true })
        .bindPopup(() => buildPopup(pois.get(poi.id)), { minWidth: 220, maxWidth: 280 })
        .on("popupopen", () => setActivePoi(poi.id))
        .on("popupclose", () => { if (activePoiId === poi.id) setActivePoi(null); });
      markers.set(poi.id, marker);
    }
    syncMarker(poi.id);
    renderList();
  }

  function removePoi(id) {
    const marker = markers.get(id);
    if (marker) marker.remove();
    markers.delete(id);
    pois.delete(id);
    renderFilter();
    renderList();
  }

  async function deletePoi(id, button) {
    button.disabled = true;
    try {
      await api("DELETE", `/api/pois/${encodeURIComponent(id)}`);
      map.closePopup();
      removePoi(id);
      toast("POI gelöscht");
    } catch (err) {
      if (err.status === 404) {
        map.closePopup();
        removePoi(id);
      }
      toast(err.message, true);
      button.disabled = false;
    }
  }

  async function loadData() {
    try {
      const [categoryList, poiData] = await Promise.all([
        api("GET", "/api/categories"),
        api("GET", "/api/pois")
      ]);
      for (const category of categoryList) categories.set(category.id, category);
      for (const id of [...hiddenCategories]) {
        if (!categories.has(id)) hiddenCategories.delete(id);
      }
      renderCategoryOptions();
      poiData.forEach(upsertPoi);
      renderFilter();
      renderList();
    } catch (err) {
      toast(`Daten konnten nicht geladen werden: ${err.message}`, true);
    }
  }

  // -------------------------------------------------------------------------
  // Filter
  // -------------------------------------------------------------------------

  function setFilterOpen(open) {
    filterPanel.hidden = !open;
    btnFilter.setAttribute("aria-expanded", String(open));
  }

  function renderFilter() {
    const counts = new Map();
    for (const poi of pois.values()) {
      const id = categoryOf(poi) ? categoryOf(poi).id : poi.category;
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    filterList.replaceChildren(...[...categories.values()].map((category) =>
      el("li", null,
        el("label", { class: "filter-item" },
          el("input", {
            type: "checkbox",
            value: category.id,
            checked: !hiddenCategories.has(category.id),
            onchange: (e) => setCategoryVisible(category.id, e.target.checked)
          }),
          categoryBadgeIcon(category),
          el("span", { class: "name" }, category.name),
          el("span", { class: "count", "aria-label": `${counts.get(category.id) || 0} POIs` },
            String(counts.get(category.id) || 0))
        )
      )
    ));

    filterDot.hidden = hiddenCategories.size === 0;
    btnFilter.setAttribute("aria-label", hiddenCategories.size ? "Filter (aktiv)" : "Filter");
  }

  function applyFilter() {
    storageSet(HIDDEN_KEY, JSON.stringify([...hiddenCategories]));
    for (const id of markers.keys()) syncMarker(id);
    renderList();
    filterDot.hidden = hiddenCategories.size === 0;
    btnFilter.setAttribute("aria-label", hiddenCategories.size ? "Filter (aktiv)" : "Filter");
  }

  function setCategoryVisible(id, visible) {
    if (visible) hiddenCategories.delete(id);
    else hiddenCategories.add(id);
    applyFilter();
  }

  btnFilter.addEventListener("click", () => {
    const open = filterPanel.hidden;
    if (open) {
      setPicking(false);
      closeResults();
      if (isMobile()) setListOpen(false);
    }
    setFilterOpen(open);
  });

  for (const button of filterPanel.querySelectorAll("[data-filter]")) {
    button.addEventListener("click", () => {
      hiddenCategories.clear();
      if (button.dataset.filter === "none") {
        for (const id of categories.keys()) hiddenCategories.add(id);
      }
      applyFilter();
      renderFilter();
    });
  }

  // Klick außerhalb schließt den Filter.
  document.addEventListener("click", (e) => {
    if (filterPanel.hidden) return;
    if (filterPanel.contains(e.target) || btnFilter.contains(e.target)) return;
    setFilterOpen(false);
  });

  // -------------------------------------------------------------------------
  // Karte zu einem Ort bewegen
  // -------------------------------------------------------------------------

  // Bewegt die Karte so, dass latlng gut sichtbar ist: nicht unter der
  // Seitenleiste und mit Platz für das Popup darüber.
  function flyToVisible(latlng, zoom, done) {
    const leftCover = listOpen && !isMobile() ? listPanel.offsetWidth : 0;
    const centerPoint = map.project(latlng, zoom).subtract(L.point(leftCover / 2, 90));
    const target = map.unproject(centerPoint, zoom);

    const current = map.project(map.getCenter(), zoom);
    if (zoom === map.getZoom() && current.distanceTo(centerPoint) < 2) {
      if (done) done();
      return;
    }
    if (done) map.once("moveend", done);
    if (map.getCenter().distanceTo(target) > 3000) map.flyTo(target, zoom, { duration: 0.8 });
    else map.setView(target, zoom, { animate: true });
  }

  function focusPoi(id) {
    const poi = pois.get(id);
    if (!poi) return;
    // Ausgeblendete Kategorie wieder anzeigen, damit der Ort sichtbar ist.
    if (hiddenCategories.delete(poi.category)) {
      applyFilter();
      renderFilter();
    }
    setPicking(false);
    if (editing) closeForm();
    if (isMobile()) setListOpen(false);
    const zoom = Math.max(map.getZoom(), 16);
    flyToVisible(L.latLng(poi.lat, poi.lng), zoom, () => {
      const marker = markers.get(id);
      if (marker && map.hasLayer(marker)) marker.openPopup();
    });
  }

  // -------------------------------------------------------------------------
  // Liste (Seitenleiste)
  // -------------------------------------------------------------------------

  function setListOpen(open) {
    if (open === listOpen) return;
    listOpen = open;
    listPanel.classList.toggle("is-open", open);
    listPanel.inert = !open;
    document.body.classList.toggle("list-open", open);
    btnList.setAttribute("aria-expanded", String(open));
    if (open) {
      setFilterOpen(false);
      if (isMobile()) closeSearch();
      renderList();
    }
  }

  btnList.addEventListener("click", () => setListOpen(!listOpen));
  listClose.addEventListener("click", () => {
    setListOpen(false);
    btnList.focus();
  });

  function renderList() {
    if (!listOpen) return;

    const all = [...pois.values()];
    const visible = all
      .filter((poi) => !hiddenCategories.has(poi.category))
      .sort((a, b) => a.title.localeCompare(b.title, "de", { sensitivity: "base" }));
    const hiddenCount = all.length - visible.length;

    listCount.textContent = String(visible.length);
    listEmpty.hidden = all.length > 0;
    listHint.hidden = hiddenCount === 0;
    if (hiddenCount) {
      listHint.replaceChildren(
        `${hiddenCount} ${hiddenCount === 1 ? "weiterer Ort ist" : "weitere Orte sind"} durch den Filter ausgeblendet. `,
        el("button", {
          type: "button",
          class: "link-btn",
          onclick: () => {
            hiddenCategories.clear();
            applyFilter();
            renderFilter();
          }
        }, "Alle zeigen")
      );
    }

    poiList.replaceChildren(...visible.map((poi) => {
      const category = categoryOf(poi);
      return el("li", null,
        el("button", {
          type: "button",
          class: poi.id === activePoiId ? "poi-item is-active" : "poi-item",
          "data-id": poi.id,
          style: category ? `--cat:${safeColor(category.color)}` : null,
          onclick: () => focusPoi(poi.id)
        },
          category ? categoryBadgeIcon(category) : null,
          el("span", { class: "text" },
            el("span", { class: "title" }, poi.title),
            category ? el("span", { class: "cat" }, category.name) : null,
            poi.address ? el("span", { class: "address" }, poi.address) : null
          )
        )
      );
    }));
  }

  function setActivePoi(id) {
    activePoiId = id;
    for (const item of poiList.querySelectorAll(".poi-item")) {
      item.classList.toggle("is-active", item.dataset.id === id);
    }
  }

  // -------------------------------------------------------------------------
  // Suche
  // -------------------------------------------------------------------------

  // Kleinschreibung, ohne Akzente, ß → ss: „Café“ findet auch „cafe“.
  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ß/g, "ss");
  }

  function searchPois(query) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    for (const poi of pois.values()) {
      const category = categoryOf(poi);
      const title = normalize(poi.title);
      const haystack = [title, normalize(poi.address), normalize(poi.description), normalize(category && category.name)].join(" ");
      if (!terms.every((term) => haystack.includes(term))) continue;
      const score = title.startsWith(terms[0]) ? 2 : terms.every((term) => title.includes(term)) ? 1 : 0;
      hits.push({ poi, score });
    }
    return hits
      .sort((a, b) => b.score - a.score || a.poi.title.localeCompare(b.poi.title, "de", { sensitivity: "base" }))
      .slice(0, 8)
      .map((hit) => hit.poi);
  }

  function placeIcon(name) {
    const span = el("span", { class: "place-icon", "aria-hidden": "true" });
    span.innerHTML = UI_ICONS[name];
    return span;
  }

  function renderSearch({ highlightAddress = false } = {}) {
    const query = searchInput.value.trim();
    if (!query) {
      closeResults();
      return;
    }

    const options = [];
    const addOption = (section, iconNode, title, sub, run, isAction = false) => {
      const index = options.length;
      const option = el("div", {
        class: isAction ? "search-option is-action" : "search-option",
        role: "option",
        id: `search-option-${index}`,
        "aria-selected": "false",
        // mousedown würde den Fokus vom Suchfeld nehmen
        onmousedown: (e) => e.preventDefault(),
        onclick: run
      },
        iconNode,
        el("span", { class: "text" },
          el("span", { class: "title" }, title),
          sub ? el("span", { class: "sub" }, sub) : null
        )
      );
      section.append(option);
      options.push({ node: option, run });
    };
    const note = (section, text) => section.append(el("p", { class: "search-note" }, text));

    // Meine Orte
    const poiSection = el("div", { class: "search-section", role: "group", "aria-label": "Meine Orte" },
      el("h3", null, "Meine Orte"));
    const matches = searchPois(query);
    for (const poi of matches) {
      const category = categoryOf(poi);
      addOption(poiSection,
        category ? categoryBadgeIcon(category) : placeIcon("place"),
        poi.title,
        [category && category.name, poi.address].filter(Boolean).join(" · "),
        () => selectPoi(poi.id));
    }
    if (!matches.length) note(poiSection, "Keine passenden Orte.");

    // Adressen (OpenStreetMap)
    const addressSection = el("div", { class: "search-section", role: "group", "aria-label": "Adressen" },
      el("h3", null, "Adressen"));
    const firstAddressIndex = options.length;
    const state = addressSearch.query === query ? addressSearch.status : "idle";
    if (state === "done") {
      for (const result of addressSearch.results) {
        addOption(addressSection, placeIcon("place"), result.label, result.address, () => selectAddress(result));
      }
      if (!addressSearch.results.length) note(addressSection, `Keine Adressen in ${city.name} gefunden.`);
    } else if (state === "loading") {
      note(addressSection, "Suche läuft …");
    } else if (state === "error") {
      note(addressSection, addressSearch.error);
      addOption(addressSection, placeIcon("search"), "Erneut versuchen", null, () => runAddressSearch(query), true);
    } else if (query.length >= 2) {
      addOption(addressSection, placeIcon("search"), `Adressen suchen: „${query}“`,
        isMobile() ? "Antippen oder Suchen drücken" : "Enter drücken", () => runAddressSearch(query), true);
    } else {
      note(addressSection, "Für Adressen mindestens zwei Zeichen eingeben.");
    }

    searchResults.replaceChildren(poiSection, addressSection);
    searchOptions = options;
    searchResults.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");

    if (highlightAddress && state === "done" && addressSearch.results.length) setActiveOption(firstAddressIndex);
    else setActiveOption(-1);
  }

  function setActiveOption(index) {
    activeOption = index;
    searchOptions.forEach((option, i) => {
      option.node.classList.toggle("is-active", i === index);
      option.node.setAttribute("aria-selected", String(i === index));
    });
    if (index >= 0) {
      searchInput.setAttribute("aria-activedescendant", searchOptions[index].node.id);
      searchOptions[index].node.scrollIntoView({ block: "nearest" });
    } else {
      searchInput.removeAttribute("aria-activedescendant");
    }
  }

  function closeResults() {
    searchResults.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchOptions = [];
    setActiveOption(-1);
  }

  async function runAddressSearch(query) {
    if (query.length < 2) return;
    addressSearch = { query, status: "loading", results: [], error: "" };
    renderSearch();
    try {
      const results = await api("GET", `/api/geocode/search?q=${encodeURIComponent(query)}`);
      if (addressSearch.query !== query) return;
      addressSearch = { query, status: "done", results, error: "" };
    } catch (err) {
      if (addressSearch.query !== query) return;
      addressSearch = { query, status: "error", results: [], error: err.message };
    }
    if (searchInput.value.trim() === query && document.activeElement === searchInput) {
      renderSearch({ highlightAddress: true });
    }
  }

  // Suche nach einer Auswahl schließen (auf dem Smartphone ganz).
  function finishSearch() {
    closeResults();
    searchInput.blur();
    if (isMobile()) closeSearch();
  }

  function selectPoi(id) {
    finishSearch();
    focusPoi(id);
  }

  function selectAddress(result) {
    finishSearch();
    setPicking(false);
    if (editing) closeForm();
    showSearchMarker(result);
    flyToVisible(L.latLng(result.lat, result.lng), 17, () => {
      if (searchMarker) searchMarker.openPopup();
    });
  }

  const searchPinIcon = L.divIcon({
    className: "search-pin",
    html: "<span></span>",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12]
  });

  function showSearchMarker(result) {
    clearSearchMarker();
    searchMarker = L.marker([result.lat, result.lng], { icon: searchPinIcon, title: result.label, zIndexOffset: 500 })
      .bindPopup(() => buildAddressPopup(result), { minWidth: 200, maxWidth: 280 })
      .addTo(map);
  }

  function clearSearchMarker() {
    if (!searchMarker) return;
    searchMarker.remove();
    searchMarker = null;
  }

  function buildAddressPopup(result) {
    return el("div", { class: "poi-popup" },
      el("span", { class: "cat-badge", style: "--cat:#1f2328" }, placeIcon("search"), "Suchergebnis"),
      el("h3", null, result.label),
      result.address ? el("p", { class: "meta" }, uiIcon("place"), el("span", null, result.address)) : null,
      routeButton({ lat: result.lat, lng: result.lng, label: result.label }),
      el("div", { class: "actions" },
        el("button", {
          type: "button",
          class: "btn btn-sm btn-primary",
          onclick: later(() => {
            if (categories.size === 0) return;
            clearSearchMarker();
            openForm(null, L.latLng(result.lat, result.lng), {
              title: result.address ? result.label : "",
              address: result.address || result.label
            });
          })
        }, "Als POI anlegen"),
        el("button", { type: "button", class: "btn btn-sm", onclick: later(clearSearchMarker) }, "Entfernen")
      )
    );
  }

  function openSearch() {
    document.body.classList.add("search-open");
    setFilterOpen(false);
    if (isMobile()) setListOpen(false);
    searchInput.focus();
    if (searchInput.value.trim()) renderSearch();
  }

  function closeSearch() {
    document.body.classList.remove("search-open");
    closeResults();
  }

  btnSearch.addEventListener("click", openSearch);
  searchClose.addEventListener("click", () => {
    closeSearch();
    btnSearch.focus();
  });

  searchInput.addEventListener("input", () => renderSearch());
  searchInput.addEventListener("focus", () => {
    setFilterOpen(false);
    if (searchInput.value.trim()) renderSearch();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (searchResults.hidden) renderSearch();
      if (!searchOptions.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = activeOption < 0
        ? (step > 0 ? 0 : searchOptions.length - 1)
        : (activeOption + step + searchOptions.length) % searchOptions.length;
      setActiveOption(next);
    } else if (e.key === "Enter" && activeOption >= 0 && !searchResults.hidden) {
      e.preventDefault();
      searchOptions[activeOption].run();
    } else if (e.key === "Escape") {
      // Eigenes Escape-Verhalten, nicht das globale
      e.preventDefault();
      e.stopPropagation();
      if (!searchResults.hidden) closeResults();
      else if (isMobile()) closeSearch();
      else searchInput.blur();
    }
  });

  // Enter (bzw. „Suchen“ auf der Handytastatur) startet die Adresssuche.
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (query.length >= 2) runAddressSearch(query);
  });

  // Klick außerhalb schließt die Ergebnisse.
  document.addEventListener("click", (e) => {
    if (searchForm.contains(e.target) || btnSearch.contains(e.target)) return;
    if (isMobile() && document.body.classList.contains("search-open")) closeSearch();
    else closeResults();
  });

  // Beim Wechsel zwischen Handy- und Desktop-Layout aufräumen.
  mobileQuery.addEventListener("change", () => {
    closeSearch();
  });

  // -------------------------------------------------------------------------
  // Routenplanung (Start: eigener Standort, Routing über den Server/OSRM)
  // -------------------------------------------------------------------------

  const MODES = {
    foot: { label: "Zu Fuß", phrase: "zu Fuß", color: "#2563eb" },
    bike: { label: "Fahrrad", phrase: "mit dem Fahrrad", color: "#0f8a80" },
    car: { label: "Auto", phrase: "mit dem Auto", color: "#7c4dcc" }
  };
  const MODE_KEY = "stadtapp.routeMode";

  const routePanel = $("route-panel");
  const routeTitle = $("route-title");
  const routeSummary = $("route-summary");
  const routeClose = $("route-close");
  const modeButtons = routePanel.querySelectorAll(".mode-btn");

  const routeLayer = L.layerGroup().addTo(map);
  let route = null; // { to: {lat, lng, label}, mode, from: LatLng|null, data }
  let routeToken = 0; // verwirft veraltete Antworten

  const ROUTE_ICON =
    '<svg class="route-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="2.5"/>' +
    '<circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/></svg>';

  function routeButton(target) {
    return el("button", {
      type: "button",
      class: "btn btn-sm btn-primary route-btn",
      onclick: later(() => startRoute(target))
    }, fromHtml(ROUTE_ICON), "Route hierher");
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
    const km = meters / 1000;
    return `${km.toLocaleString("de-DE", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
  }

  function formatDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
  }

  function setRouteSummary(...content) {
    routeSummary.classList.remove("is-error");
    routeSummary.replaceChildren(...content);
  }

  function routeError(message) {
    routeLayer.clearLayers();
    routeSummary.classList.add("is-error");
    routeSummary.replaceChildren(
      el("span", null, message),
      el("button", { type: "button", class: "link-btn", onclick: () => locateAndRoute() }, "Erneut versuchen")
    );
  }

  function updateModeButtons() {
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === route.mode));
    }
  }

  function startRoute(target) {
    map.closePopup();
    setPicking(false);
    if (editing) closeForm();
    if (isMobile()) setListOpen(false);

    const savedMode = storageGet(MODE_KEY);
    route = {
      to: target,
      mode: route ? route.mode : (MODES[savedMode] ? savedMode : "foot"),
      from: null,
      data: null
    };
    routeTitle.textContent = target.label;
    routeTitle.title = target.label;
    updateModeButtons();
    routeLayer.clearLayers();
    routePanel.hidden = false;
    document.body.classList.add("route-open");
    locateAndRoute();
  }

  function geolocationMessage(error) {
    if (error.code === error.PERMISSION_DENIED) {
      return "Du hast den Zugriff auf deinen Standort nicht erlaubt. Ohne Standort kann keine Route " +
        "berechnet werden. Du kannst den Zugriff in den Website-Einstellungen deines Browsers erlauben.";
    }
    if (error.code === error.TIMEOUT) {
      return "Die Standortbestimmung hat zu lange gedauert.";
    }
    return "Dein Standort konnte nicht bestimmt werden. Sind die Ortungsdienste eingeschaltet?";
  }

  function locateAndRoute() {
    if (!route) return;
    const token = ++routeToken;
    if (!("geolocation" in navigator)) {
      routeError("Dein Browser kann deinen Standort nicht bestimmen.");
      return;
    }
    if (!window.isSecureContext) {
      routeError("Der Standort ist nur über eine sichere Verbindung (https) verfügbar.");
      return;
    }
    setRouteSummary(el("span", { class: "muted" }, "Standort wird ermittelt …"));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (token !== routeToken || !route) return;
        route.from = L.latLng(position.coords.latitude, position.coords.longitude);
        calculateRoute();
      },
      (error) => {
        if (token !== routeToken || !route) return;
        routeError(geolocationMessage(error));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function calculateRoute() {
    const token = ++routeToken;
    const { from, to, mode } = route;
    setRouteSummary(el("span", { class: "muted" }, "Route wird berechnet …"));
    try {
      const data = await api("GET",
        `/api/route?profile=${mode}&from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`);
      if (token !== routeToken || !route) return;
      route.data = data;
      drawRoute();
      setRouteSummary(el("div", { class: "figures" },
        el("strong", null, formatDistance(data.distance)),
        el("span", null, `ca. ${formatDuration(data.duration)} ${MODES[mode].phrase}`)
      ));
    } catch (err) {
      if (token !== routeToken || !route) return;
      routeError(err.message);
    }
  }

  function drawRoute() {
    routeLayer.clearLayers();
    const { data, mode, from, to } = route;
    const line = data.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    L.polyline(line, { color: "#fff", weight: 9, opacity: 0.9, interactive: false }).addTo(routeLayer);
    L.polyline(line, { color: MODES[mode].color, weight: 5, opacity: 0.95, interactive: false }).addTo(routeLayer);
    L.marker(from, {
      icon: L.divIcon({ className: "my-location", html: "<span></span>", iconSize: [18, 18], iconAnchor: [9, 9] }),
      title: "Dein Standort",
      keyboard: false
    }).bindTooltip("Dein Standort").addTo(routeLayer);

    // Ganze Route zeigen, ohne dass Liste oder Routen-Karte sie verdecken
    const bounds = L.latLngBounds(line).extend(from).extend([to.lat, to.lng]);
    const leftCover = listOpen && !isMobile() ? listPanel.offsetWidth : 0;
    map.fitBounds(bounds, {
      paddingTopLeft: [leftCover + 40, 40],
      paddingBottomRight: [40, routePanel.offsetHeight + 50],
      maxZoom: 17
    });
  }

  function closeRoute() {
    routeToken++;
    route = null;
    routeLayer.clearLayers();
    routePanel.hidden = true;
    document.body.classList.remove("route-open");
  }

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      if (!route || route.mode === button.dataset.mode) return;
      route.mode = button.dataset.mode;
      storageSet(MODE_KEY, route.mode);
      updateModeButtons();
      if (route.from) calculateRoute();
      else locateAndRoute();
    });
  }

  routeClose.addEventListener("click", closeRoute);

  // -------------------------------------------------------------------------
  // Ort auswählen
  // -------------------------------------------------------------------------

  function setPicking(on) {
    picking = on;
    document.body.classList.toggle("picking", on);
    pickHint.hidden = !on;
    btnNew.setAttribute("aria-pressed", String(on));
    btnNewLabel.textContent = on ? "Abbrechen" : "Neuer POI";
    btnNew.setAttribute("aria-label", on ? "Auswahl abbrechen" : "Neuer POI");
  }

  btnNew.addEventListener("click", () => {
    if (picking) {
      setPicking(false);
      return;
    }
    if (categories.size === 0) {
      toast("Die Kategorien sind noch nicht geladen. Bitte lade die Seite neu.", true);
      return;
    }
    setFilterOpen(false);
    closeSearch();
    if (isMobile()) setListOpen(false);
    closeForm();
    map.closePopup();
    setPicking(true);
  });

  map.on("click", (e) => {
    if (picking) {
      setPicking(false);
      openForm(null, e.latlng);
    } else if (editing) {
      // Bei offenem Formular verschiebt ein Klick den Marker.
      moveDraft(e.latlng);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!searchResults.hidden) closeResults();
    else if (document.body.classList.contains("search-open")) closeSearch();
    else if (!filterPanel.hidden) setFilterOpen(false);
    else if (picking) setPicking(false);
    else if (editing) closeForm();
    else if (listOpen) setListOpen(false);
    else if (route) closeRoute();
  });

  // -------------------------------------------------------------------------
  // Formular
  // -------------------------------------------------------------------------

  function renderCategoryOptions() {
    categoryOptions.replaceChildren(...[...categories.values()].map((category) =>
      el("label", { class: "cat-option" },
        el("input", { type: "radio", name: "category", value: category.id }),
        el("span", { class: "cat-chip", style: `--cat:${safeColor(category.color)}` },
          categoryBadgeIcon(category),
          el("span", { class: "name" }, category.name)
        )
      )
    ));
  }

  function selectedCategory() {
    const checked = form.querySelector('input[name="category"]:checked');
    return checked ? categories.get(checked.value) : null;
  }

  function selectCategory(id) {
    for (const input of form.querySelectorAll('input[name="category"]')) {
      input.checked = input.value === id;
    }
  }

  categoryOptions.addEventListener("change", () => {
    categoryField.removeAttribute("aria-invalid");
    if (editing) editing.draft.setIcon(pinIcon(selectedCategory(), true));
  });

  // preset (optional): { title, address } zum Vorausfüllen, z. B. aus der Suche
  function openForm(poi, latlng, preset) {
    closeForm();
    map.closePopup();

    const id = poi ? poi.id : null;
    const category = poi ? categoryOf(poi) : null;
    const draft = L.marker(latlng, {
      icon: pinIcon(category, true),
      draggable: true,
      zIndexOffset: 1000,
      title: "Ziehen, um den Ort zu ändern"
    }).addTo(map);
    draft.on("dragend", () => moveDraft(draft.getLatLng()));

    // Beim Bearbeiten ersetzt der verschiebbare Marker den normalen.
    editing = { id, draft };
    if (id) syncMarker(id);

    const f = form.elements;
    form.reset();
    selectCategory(category ? category.id : null);
    f.title.value = poi ? poi.title : (preset && preset.title) || "";
    f.description.value = poi ? poi.description : "";
    f.address.value = poi ? poi.address : (preset && preset.address) || "";
    f.author.value = poi ? poi.author : storageGet(AUTHOR_KEY) || "";
    f.address.placeholder = ADDRESS_PLACEHOLDER;
    for (const node of form.querySelectorAll("[aria-invalid]")) node.removeAttribute("aria-invalid");
    panelTitle.textContent = id ? "POI bearbeiten" : "Neuer POI";
    addressHint.textContent = "";
    formError.hidden = true;
    addressTouched = Boolean(preset && preset.address);
    panel.hidden = false;
    panel.scrollTop = 0;
    document.body.classList.add("form-open");

    if (!id && !addressTouched) lookupAddress(latlng);
    keepVisible(latlng);
    if (window.matchMedia("(pointer: fine)").matches) f.title.focus();
  }

  function closeForm() {
    if (!editing) return;
    geocodeToken++;
    const { id, draft } = editing;
    draft.remove();
    editing = null;
    if (id) syncMarker(id);
    panel.hidden = true;
    document.body.classList.remove("form-open");
  }

  function moveDraft(latlng) {
    if (!editing) return;
    editing.draft.setLatLng(latlng);
    if (!addressTouched) lookupAddress(latlng);
  }

  async function lookupAddress(latlng) {
    const token = ++geocodeToken;
    const input = form.elements.address;
    const { lat, lng } = latlng.wrap();
    input.placeholder = "Adresse wird ermittelt …";
    addressHint.textContent = "";
    try {
      const { address } = await api("GET", `/api/geocode/reverse?lat=${lat}&lng=${lng}`);
      if (token !== geocodeToken || addressTouched) return;
      if (address) {
        input.value = address;
        addressHint.textContent = "Automatisch über OpenStreetMap ermittelt – du kannst sie ändern.";
      } else {
        addressHint.textContent = "Für diese Stelle wurde keine Adresse gefunden.";
      }
    } catch {
      if (token !== geocodeToken) return;
      addressHint.textContent = "Adresse konnte nicht ermittelt werden – trage sie gern selbst ein.";
    } finally {
      if (token === geocodeToken) input.placeholder = ADDRESS_PLACEHOLDER;
    }
  }

  form.elements.address.addEventListener("input", () => {
    addressTouched = true;
    addressHint.textContent = "";
  });

  for (const name of ["title", "author"]) {
    form.elements[name].addEventListener("input", (e) => e.target.removeAttribute("aria-invalid"));
  }

  // Sobald alle Pflichtangaben vorhanden sind, verschwindet die Fehlermeldung.
  for (const type of ["input", "change"]) {
    form.addEventListener(type, () => {
      if (!formError.hidden && !form.querySelector('[aria-invalid="true"]')) formError.hidden = true;
    });
  }

  for (const button of panel.querySelectorAll('[data-action="close"]')) {
    button.addEventListener("click", closeForm);
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editing) return;

    const f = form.elements;
    const category = selectedCategory();
    const data = {
      title: f.title.value.trim(),
      category: category ? category.id : "",
      description: f.description.value.trim(),
      address: f.address.value.trim(),
      author: f.author.value.trim()
    };

    const problems = [];
    if (!data.title) {
      f.title.setAttribute("aria-invalid", "true");
      problems.push(["Titel", f.title]);
    }
    if (!category) {
      categoryField.setAttribute("aria-invalid", "true");
      problems.push(["Kategorie", categoryField.querySelector("input")]);
    }
    if (!data.author) {
      f.author.setAttribute("aria-invalid", "true");
      problems.push(["Autor:in", f.author]);
    }
    if (problems.length) {
      const names = problems.map(([name]) => name);
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names.at(-1)}` : names[0];
      showError(`Bitte noch ausfüllen: ${list}.`);
      problems[0][1].focus();
      return;
    }

    const { lat, lng } = editing.draft.getLatLng().wrap();
    Object.assign(data, { lat, lng });
    const { id } = editing;

    btnSave.disabled = true;
    formError.hidden = true;
    try {
      const saved = id
        ? await api("PUT", `/api/pois/${encodeURIComponent(id)}`, data)
        : await api("POST", "/api/pois", data);
      storageSet(AUTHOR_KEY, data.author);

      // Neue/geänderte POIs sollen sichtbar sein, auch wenn ihre Kategorie
      // gerade ausgeblendet war.
      const wasHidden = hiddenCategories.delete(saved.category);
      if (wasHidden) applyFilter();

      closeForm();
      upsertPoi(saved);
      renderFilter();
      markers.get(saved.id).openPopup();
      const message = id ? "Änderungen gespeichert" : "POI angelegt";
      toast(wasHidden ? `${message} – Kategorie „${category.name}“ wird wieder angezeigt` : message);
    } catch (err) {
      if (err.status === 404 && id) {
        closeForm();
        removePoi(id);
        toast(err.message, true);
      } else {
        showError(err.message || "Speichern fehlgeschlagen.");
      }
    } finally {
      btnSave.disabled = false;
    }
  });

  function startEdit(id) {
    const poi = pois.get(id);
    if (!poi) return;
    setPicking(false);
    openForm(poi, L.latLng(poi.lat, poi.lng));
  }

  // Verschiebt die Karte so, dass der Marker nicht vom Formular verdeckt wird.
  function keepVisible(latlng) {
    requestAnimationFrame(() => {
      const size = map.getSize();
      const point = map.latLngToContainerPoint(latlng);
      const mapRect = map.getContainer().getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      const free = { left: 0, top: 0, right: size.x, bottom: size.y };
      if (panelRect.width >= mapRect.width - 1) free.bottom = panelRect.top - mapRect.top; // Smartphone: Panel unten
      else free.right = panelRect.left - mapRect.left; // Desktop: Panel rechts

      const margin = 40;
      const target = L.point(
        Math.min(Math.max(point.x, free.left + margin), Math.max(free.right - margin, free.left + margin)),
        Math.min(Math.max(point.y, free.top + margin + 40), Math.max(free.bottom - margin, free.top + margin + 40))
      );
      const offset = point.subtract(target);
      if (offset.x || offset.y) map.panBy(offset);
    });
  }

  loadData();
})();
