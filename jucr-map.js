/*
 * JUCR Map Widget — embeddable interactive map (MapLibre GL + OpenStreetMap).
 *
 *   <div data-jucr-map="https://HOST/maps/hazy/"></div>
 *   <script src="https://HOST/jucr-map.js" defer></script>
 *
 * Faithful to the original Google-Maps version: KML data layers show feature
 * names (polygons labeled at centroid; every feature clickable for its
 * name/description), red database "story" markers show full popups, and the
 * layer panel doubles as a legend. Layers with manifest "default": true load on.
 */
(function () {
  "use strict";
  var MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
  var MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
  var PALETTE = ["#2e6da4", "#5a3e8e", "#c97a1a", "#2e8b57", "#b0413e",
                 "#7a3b8f", "#1f7a7a", "#8a6d1a", "#4a6fa5", "#9c4d2f"];
  var MARKER_COLOR = "#c0392b";

  function loadOnce(tag, attrs) {
    return new Promise(function (resolve) {
      if (document.querySelector(tag + "[data-jucr=\"1\"]")) { resolve(); return; }
      var el = document.createElement(tag);
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      el.setAttribute("data-jucr", "1");
      el.onload = function () { resolve(); };
      if (tag !== "script") setTimeout(resolve, 0);
      document.head.appendChild(el);
    });
  }
  function ensureMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    return loadOnce("link", { rel: "stylesheet", href: MAPLIBRE_CSS })
      .then(function () { return loadOnce("script", { src: MAPLIBRE_JS }); });
  }
  function miniMarkdown(md) {
    if (!md) return "";
    var html = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return html.split(/\n{2,}/).map(function (p) { return "<p>" + p.replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  function resolveImage(ref, mediaBase) {
    if (!ref || /failed initial if statement/i.test(ref)) return null;
    if (mediaBase) {
      var clean = decodeURIComponent(ref.split("?")[0].split("#")[0]);
      var bn = clean.substring(clean.lastIndexOf("/") + 1);
      return mediaBase.replace(/\/$/, "") + "/" + encodeURIComponent(bn);
    }
    if (/^https?:\/\//.test(ref)) return ref;
    return null;
  }
  function markerPopup(p, mediaBase) {
    var html = "<div class='jucr-popup'>";
    if (p.title) html += "<h3>" + p.title + "</h3>";
    html += miniMarkdown(p.body_md || "");
    var img = resolveImage(p.image, mediaBase);
    if (img) html += "<img src='" + img + "' alt='" + (p.image_desc || "") + "' onerror=\"this.style.display='none'\">";
    if (p.details_link && p.link_to_full) html += "<p><a href='" + p.details_link + "' target='_blank' rel='noopener'>Read more &rarr;</a></p>";
    return html + "</div>";
  }
  function featurePopup(props, layerLabel) {
    var name = props && (props.name || props.Name);
    var desc = props && props.description;
    var html = "<div class='jucr-popup'><div class='jucr-popup-layer'>" + layerLabel + "</div>";
    if (name) html += "<h3>" + name + "</h3>";
    if (desc && !/^exported from/i.test(desc)) html += "<p>" + desc + "</p>";
    return html + "</div>";
  }
  function prettyLabel(s) {
    return (s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function addGeoJSONLayer(map, id, data, color, label, visible) {
    var vis = visible ? "visible" : "none";
    map.addSource(id, { type: "geojson", data: data });
    map.addLayer({ id: id + "-fill", type: "fill", source: id,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": color, "fill-opacity": 0.15 }, layout: { visibility: vis } });
    map.addLayer({ id: id + "-line", type: "line", source: id,
      filter: ["in", ["geometry-type"], ["literal", ["Polygon", "LineString"]]],
      paint: { "line-color": color, "line-width": 1.8 }, layout: { visibility: vis } });
    map.addLayer({ id: id + "-pt", type: "circle", source: id,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 3.6, "circle-color": color, "circle-opacity": 0.85,
        "circle-stroke-width": 0.6, "circle-stroke-color": "#fff" }, layout: { visibility: vis } });
    map.addLayer({ id: id + "-label", type: "symbol", source: id,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: { "text-field": ["coalesce", ["get", "name"], ["get", "Name"], ""],
        "text-size": 11, "text-allow-overlap": false, "visibility": vis },
      paint: { "text-color": color, "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
    var ids = [id + "-fill", id + "-line", id + "-pt", id + "-label"];
    [id + "-fill", id + "-line", id + "-pt"].forEach(function (lid) {
      map.on("click", lid, function (e) {
        new maplibregl.Popup({ maxWidth: "260px" }).setLngLat(e.lngLat)
          .setHTML(featurePopup(e.features[0].properties, label)).addTo(map);
      });
      map.on("mouseenter", lid, function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", lid, function () { map.getCanvas().style.cursor = ""; });
    });
    return ids;
  }
  function makeToggle(label, color, checked, onChange) {
    var l = document.createElement("label");
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked;
    cb.addEventListener("change", function () { onChange(cb.checked); });
    var sw = document.createElement("span"); sw.className = "jucr-swatch"; sw.style.background = color;
    var tx = document.createElement("span"); tx.textContent = label;
    l.appendChild(cb); l.appendChild(sw); l.appendChild(tx);
    return l;
  }

  async function initOne(container) {
    var base = container.getAttribute("data-jucr-map"); if (!base) return;
    if (base.slice(-1) !== "/") base += "/";
    var mediaBase = container.getAttribute("data-media-base") || "";
    container.classList.add("jucr-map-widget");
    container.style.position = "relative";
    container.style.height = container.getAttribute("data-height") || "520px";
    var mapEl = document.createElement("div"); mapEl.className = "jucr-map-canvas"; container.appendChild(mapEl);
    var panel = document.createElement("div"); panel.className = "jucr-map-panel";
    panel.innerHTML = "<h4>Map Layers</h4>";
    var layersBox = document.createElement("div"); layersBox.className = "jucr-layers"; panel.appendChild(layersBox);
    var note = document.createElement("div"); note.className = "jucr-note";
    note.innerHTML = "Toggle layers above. Click a <strong>marker</strong> or any shape for details.";
    panel.appendChild(note); container.appendChild(panel);

    var manifest = await (await fetch(base + "map.json")).json();
    var map = new maplibregl.Map({ container: mapEl,
      style: { version: 8, sources: { osm: { type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256,
        attribution: "© OpenStreetMap contributors" } },
        layers: [{ id: "osm", type: "raster", source: "osm" }] },
      center: manifest.center, zoom: manifest.zoom });
    map.addControl(new maplibregl.NavigationControl(), "top-left");

    map.on("load", async function () {
      for (var i = 0; i < (manifest.layers || []).length; i++) {
        var layer = manifest.layers[i];
        if (!layer.file || layer.features === 0) continue;
        var color = PALETTE[i % PALETTE.length];
        var on = !!layer.default;
        var gj; try { gj = await (await fetch(base + layer.file)).json(); } catch (e) { continue; }
        var ids = addGeoJSONLayer(map, "layer-" + layer.id, gj, color, layer.label || prettyLabel(layer.id), on);
        (function (ids) {
          layersBox.appendChild(makeToggle(layer.label || prettyLabel(layer.id), color, on, function (chk) {
            ids.forEach(function (lid) { if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", chk ? "visible" : "none"); });
          }));
        })(ids);
      }
      if (manifest.markers) {
        var markers = await (await fetch(base + manifest.markers)).json();
        if (markers.features.length) {
          map.addSource("markers", { type: "geojson", data: markers });
          map.addLayer({ id: "markers", type: "circle", source: "markers",
            paint: { "circle-radius": 8, "circle-color": MARKER_COLOR, "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
          map.on("click", "markers", function (e) {
            new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(e.lngLat).setHTML(markerPopup(e.features[0].properties, mediaBase)).addTo(map);
          });
          map.on("mouseenter", "markers", function () { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "markers", function () { map.getCanvas().style.cursor = ""; });
          layersBox.insertBefore(makeToggle("Story markers", MARKER_COLOR, true, function (chk) {
            map.setLayoutProperty("markers", "visibility", chk ? "visible" : "none"); }), layersBox.firstChild);
        }
      }
    });
  }
  function initAll() {
    var c = document.querySelectorAll("[data-jucr-map]"); if (!c.length) return;
    ensureMapLibre().then(function () { c.forEach(function (x) { initOne(x).catch(function (e) { console.error("JUCR map", e); }); }); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAll); else initAll();
  window.JUCRMap = { initAll: initAll };
})();
