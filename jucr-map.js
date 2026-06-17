/*
 * JUCR Map Widget — a self-contained, embeddable interactive map.
 *
 * Rebuilds the original Journey Up Coal River theme maps on MapLibre GL + OpenStreetMap
 * (free, no API key). Drop it into Webflow (or any HTML) with a single container element:
 *
 *   <div data-jucr-map="https://YOUR-HOST/content/maps/hazy/"></div>
 *   <script src="https://YOUR-HOST/widgets/map/jucr-map.js" defer></script>
 *
 * Options (data-* attributes on the container):
 *   data-jucr-map   (required) base URL of a map folder containing map.json
 *   data-media-base (optional) base URL to resolve marker images against
 *   data-height     (optional) CSS height, default 520px
 *
 * The widget self-loads MapLibre GL from CDN if it isn't already present.
 */
(function () {
  "use strict";

  var MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
  var MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

  // distinct colors assigned to data layers in order
  var PALETTE = ["#2e6da4", "#5a3e8e", "#c97a1a", "#2e8b57", "#b0413e",
                 "#7a3b8f", "#1f7a7a", "#8a6d1a", "#4a6fa5", "#9c4d2f"];
  var MARKER_COLOR = "#c0392b";

  function loadOnce(tag, attrs) {
    return new Promise(function (resolve) {
      var sel = tag + "[data-jucr=\"1\"]";
      if (document.querySelector(sel)) { resolve(); return; }
      var el = document.createElement(tag);
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      el.setAttribute("data-jucr", "1");
      if (tag === "script") { el.onload = function () { resolve(); }; }
      else { el.onload = function () { resolve(); }; setTimeout(resolve, 0); }
      document.head.appendChild(el);
    });
  }

  function ensureMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    return loadOnce("link", { rel: "stylesheet", href: MAPLIBRE_CSS })
      .then(function () { return loadOnce("script", { src: MAPLIBRE_JS }); });
  }

  // minimal, safe-ish markdown for short popup bodies (bold/italic/links/paragraphs)
  function miniMarkdown(md) {
    if (!md) return "";
    var html = md
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return html.split(/\n{2,}/).map(function (p) {
      return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
    }).join("");
  }

  function resolveImage(ref, mediaBase) {
    if (!ref || /failed initial if statement/i.test(ref)) return null;
    if (/^https?:\/\//.test(ref)) return ref;
    if (mediaBase) return mediaBase.replace(/\/$/, "") + "/" + ref.replace(/^\//, "");
    return null; // unknown local path with no media base -> skip gracefully
  }

  function buildPopupHTML(p, mediaBase) {
    var html = "<div class='jucr-popup'>";
    if (p.title) html += "<h3>" + p.title + "</h3>";
    html += miniMarkdown(p.body_md || "");
    var img = resolveImage(p.image, mediaBase);
    if (img) html += "<img src='" + img + "' alt='" + (p.image_desc || "") +
      "' onerror=\"this.style.display='none'\">";
    if (p.details_link && p.link_to_full) {
      html += "<p><a href='" + p.details_link + "' target='_blank' rel='noopener'>Read more &rarr;</a></p>";
    }
    return html + "</div>";
  }

  function addGeoJSONLayer(map, id, data, color, visible) {
    map.addSource(id, { type: "geojson", data: data });
    var vis = visible ? "visible" : "none";
    var ids = [];
    map.addLayer({ id: id + "-fill", type: "fill", source: id,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": color, "fill-opacity": 0.15 },
      layout: { visibility: vis } });
    map.addLayer({ id: id + "-line", type: "line", source: id,
      filter: ["in", ["geometry-type"], ["literal", ["Polygon", "LineString"]]],
      paint: { "line-color": color, "line-width": 1.6 },
      layout: { visibility: vis } });
    map.addLayer({ id: id + "-pt", type: "circle", source: id,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 3.2, "circle-color": color, "circle-opacity": 0.75,
        "circle-stroke-width": 0.5, "circle-stroke-color": "#fff" },
      layout: { visibility: vis } });
    ids.push(id + "-fill", id + "-line", id + "-pt");
    return ids;
  }

  function makeToggle(label, color, checked, onChange) {
    var l = document.createElement("label");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = checked;
    cb.addEventListener("change", function () { onChange(cb.checked); });
    var sw = document.createElement("span"); sw.className = "jucr-swatch";
    sw.style.background = color;
    var tx = document.createElement("span"); tx.textContent = label;
    l.appendChild(cb); l.appendChild(sw); l.appendChild(tx);
    return l;
  }

  async function initOne(container) {
    var base = container.getAttribute("data-jucr-map");
    if (!base) return;
    if (base.slice(-1) !== "/") base += "/";
    var mediaBase = container.getAttribute("data-media-base") || "";
    var height = container.getAttribute("data-height") || "520px";

    container.classList.add("jucr-map-widget");
    container.style.position = "relative";
    container.style.height = height;
    var mapEl = document.createElement("div");
    mapEl.className = "jucr-map-canvas";
    container.appendChild(mapEl);
    var panel = document.createElement("div");
    panel.className = "jucr-map-panel";
    panel.innerHTML = "<h4>Map Layers</h4>";
    var layersBox = document.createElement("div");
    layersBox.className = "jucr-layers";
    panel.appendChild(layersBox);
    var note = document.createElement("div");
    note.className = "jucr-note";
    note.innerHTML = "Click a <strong>marker</strong> for stories &amp; photos.";
    panel.appendChild(note);
    container.appendChild(panel);

    var manifest = await (await fetch(base + "map.json")).json();

    var map = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: { osm: { type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256,
          attribution: "© OpenStreetMap contributors" } },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: manifest.center, zoom: manifest.zoom,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-left");

    map.on("load", async function () {
      // data layers
      for (var i = 0; i < (manifest.layers || []).length; i++) {
        var layer = manifest.layers[i];
        if (!layer.file || layer.features === 0) continue;
        var color = PALETTE[i % PALETTE.length];
        try {
          var gj = await (await fetch(base + layer.file)).json();
        } catch (e) { continue; }
        var ids = addGeoJSONLayer(map, "layer-" + layer.id, gj, color, false);
        (function (ids) {
          layersBox.appendChild(makeToggle(prettyLabel(layer.label), color, false, function (on) {
            ids.forEach(function (lid) {
              if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", on ? "visible" : "none");
            });
          }));
        })(ids);
      }

      // story markers
      if (manifest.markers) {
        var markers = await (await fetch(base + manifest.markers)).json();
        if (markers.features.length) {
          map.addSource("markers", { type: "geojson", data: markers });
          map.addLayer({ id: "markers", type: "circle", source: "markers",
            paint: { "circle-radius": 8, "circle-color": MARKER_COLOR,
              "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
          map.on("click", "markers", function (e) {
            new maplibregl.Popup({ maxWidth: "300px" })
              .setLngLat(e.lngLat)
              .setHTML(buildPopupHTML(e.features[0].properties, mediaBase))
              .addTo(map);
          });
          map.on("mouseenter", "markers", function () { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "markers", function () { map.getCanvas().style.cursor = ""; });
          layersBox.insertBefore(
            makeToggle("Story markers", MARKER_COLOR, true, function (on) {
              map.setLayoutProperty("markers", "visibility", on ? "visible" : "none");
            }), layersBox.firstChild);
        }
      }
    });
  }

  function prettyLabel(s) {
    return (s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function initAll() {
    var containers = document.querySelectorAll("[data-jucr-map]");
    if (!containers.length) return;
    ensureMapLibre().then(function () {
      containers.forEach(function (c) { initOne(c).catch(function (e) { console.error("JUCR map error", e); }); });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else { initAll(); }

  window.JUCRMap = { initAll: initAll };
})();
