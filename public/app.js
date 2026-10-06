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
  const pickHint = $("pick-hint");
  const panel = $("poi-panel");
  const form = $("poi-form");
  const panelTitle = $("poi-panel-title");
  const formError = $("form-error");
  const addressHint = $("address-hint");
  const btnSave = $("btn-save");
  const toastEl = $("toast");

  const AUTHOR_KEY = "stadtapp.author";
  const ADDRESS_PLACEHOLDER = "Straße Hausnummer, PLZ Ort";

  const pois = new Map(); // id → POI
  const markers = new Map(); // id → Leaflet-Marker

  let picking = false; // wartet auf Klick in die Karte
  let editing = null; // { id: string|null, draft: Marker } während das Formular offen ist
  let addressTouched = false; // Adresse wurde von Hand geändert
  let geocodeToken = 0; // verwirft veraltete Adressantworten

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------

  const PIN_SVG =
    '<svg viewBox="0 0 30 40" aria-hidden="true">' +
    '<path d="M15 1.5C7.5 1.5 1.5 7.4 1.5 14.8c0 9.6 11.6 22 12.4 22.9a1.5 1.5 0 0 0 2.2 0' +
    'c.8-.9 12.4-13.3 12.4-22.9C28.5 7.4 22.5 1.5 15 1.5z"/>' +
    '<circle cx="15" cy="14.5" r="5"/></svg>';

  function pinIcon(draft) {
    return L.divIcon({
      className: draft ? "poi-pin is-draft" : "poi-pin",
      html: PIN_SVG,
      iconSize: [30, 40],
      iconAnchor: [15, 38],
      popupAnchor: [0, -36]
    });
  }

  const ICONS = {
    place: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>'
  };

  // Baut DOM-Elemente; Texte werden immer als Text (nie als HTML) eingesetzt.
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) {
      if (child != null && child !== false) node.append(child);
    }
    return node;
  }

  function icon(name) {
    const span = document.createElement("span");
    span.innerHTML = ICONS[name];
    return span.firstChild;
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
    root.append(el("h3", null, poi.title));
    if (poi.description) root.append(el("p", { class: "desc" }, poi.description));
    if (poi.address) root.append(el("p", { class: "meta" }, icon("place"), el("span", null, poi.address)));
    root.append(el("p", { class: "meta" }, icon("user"), el("span", null, `von ${poi.author}`)));

    const actions = el("div", { class: "actions" },
      el("button", { type: "button", class: "btn btn-sm", onclick: () => startEdit(poi.id) }, "Bearbeiten"),
      el("button", { type: "button", class: "btn btn-sm", onclick: askDelete }, "Löschen")
    );
    root.append(actions);

    // Sicherheitsabfrage direkt im Popup
    function askDelete() {
      const btnConfirm = el("button", {
        type: "button",
        class: "btn btn-sm btn-danger",
        onclick: () => deletePoi(poi.id, btnConfirm)
      }, "Ja, löschen");
      const confirmBox = el("div", { class: "confirm" },
        el("p", null, "Diesen POI wirklich löschen?"),
        el("div", { class: "actions" },
          btnConfirm,
          el("button", { type: "button", class: "btn btn-sm", onclick: () => confirmBox.replaceWith(actions) }, "Abbrechen")
        )
      );
      actions.replaceWith(confirmBox);
      btnConfirm.focus();
    }

    return root;
  }

  function upsertPoi(poi) {
    pois.set(poi.id, poi);
    let marker = markers.get(poi.id);
    if (marker) {
      marker.setLatLng([poi.lat, poi.lng]);
    } else {
      marker = L.marker([poi.lat, poi.lng], { icon: pinIcon(false), riseOnHover: true })
        .bindPopup(() => buildPopup(pois.get(poi.id)), { minWidth: 220, maxWidth: 280 })
        .addTo(map);
      markers.set(poi.id, marker);
    }
    const element = marker.getElement();
    if (element) element.setAttribute("title", poi.title);
  }

  function removePoi(id) {
    const marker = markers.get(id);
    if (marker) marker.remove();
    markers.delete(id);
    pois.delete(id);
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

  async function loadPois() {
    try {
      const list = await api("GET", "/api/pois");
      list.forEach(upsertPoi);
    } catch (err) {
      toast(`POIs konnten nicht geladen werden: ${err.message}`, true);
    }
  }

  // -------------------------------------------------------------------------
  // Ort auswählen
  // -------------------------------------------------------------------------

  function setPicking(on) {
    picking = on;
    document.body.classList.toggle("picking", on);
    pickHint.hidden = !on;
    btnNew.setAttribute("aria-pressed", String(on));
    btnNewLabel.textContent = on ? "Abbrechen" : "Neuer POI";
  }

  btnNew.addEventListener("click", () => {
    if (picking) {
      setPicking(false);
      return;
    }
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
    if (picking) setPicking(false);
    else if (editing) closeForm();
  });

  // -------------------------------------------------------------------------
  // Formular
  // -------------------------------------------------------------------------

  function openForm(poi, latlng) {
    closeForm();
    map.closePopup();

    const id = poi ? poi.id : null;
    const draft = L.marker(latlng, {
      icon: pinIcon(true),
      draggable: true,
      zIndexOffset: 1000,
      title: "Ziehen, um den Ort zu ändern"
    }).addTo(map);
    draft.on("dragend", () => moveDraft(draft.getLatLng()));

    // Beim Bearbeiten ersetzt der verschiebbare Marker den normalen.
    if (id && markers.has(id)) markers.get(id).remove();
    editing = { id, draft };

    const f = form.elements;
    form.reset();
    f.title.value = poi ? poi.title : "";
    f.description.value = poi ? poi.description : "";
    f.address.value = poi ? poi.address : "";
    f.author.value = poi ? poi.author : storageGet(AUTHOR_KEY) || "";
    f.address.placeholder = ADDRESS_PLACEHOLDER;
    for (const input of form.querySelectorAll("[aria-invalid]")) input.removeAttribute("aria-invalid");
    panelTitle.textContent = id ? "POI bearbeiten" : "Neuer POI";
    addressHint.textContent = "";
    formError.hidden = true;
    addressTouched = false;
    panel.hidden = false;

    if (!id) lookupAddress(latlng);
    keepVisible(latlng);
    if (window.matchMedia("(pointer: fine)").matches) f.title.focus();
  }

  function closeForm() {
    if (!editing) return;
    geocodeToken++;
    editing.draft.remove();
    if (editing.id && markers.has(editing.id)) markers.get(editing.id).addTo(map);
    editing = null;
    panel.hidden = true;
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
    const data = {
      title: f.title.value.trim(),
      description: f.description.value.trim(),
      address: f.address.value.trim(),
      author: f.author.value.trim()
    };

    const missing = ["title", "author"].filter((name) => !data[name]);
    for (const name of missing) f[name].setAttribute("aria-invalid", "true");
    if (missing.length) {
      showError("Bitte fülle Titel und Autor:in aus.");
      f[missing[0]].focus();
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
      closeForm();
      upsertPoi(saved);
      markers.get(saved.id).openPopup();
      toast(id ? "Änderungen gespeichert" : "POI angelegt");
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

  loadPois();
})();
