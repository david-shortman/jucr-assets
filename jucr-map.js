/*
 * JUCR Map Widget — embeddable interactive map (MapLibre GL + OpenStreetMap).
 *
 *   <div data-jucr-map="https://HOST/maps/hazy/"></div>
 *   <script src="https://HOST/jucr-map.js" defer></script>
 *
 * Optional: data-media-base (where marker images live), data-article-base
 * (prefix for article links; default "/articles/", set it to the site's
 * /articles/ URL when the map is served from another host), data-bubble-link
 * (URL prefix; when set, every marker popup ends with a legacy "Link to this
 * bubble" permalink, prefix + marker id), data-window-id (marker id to open on
 * load; defaults to the page's ?window_id= query parameter).
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
  // Marker links into the site are root-relative (/articles/...); they resolve
  // against the site that embeds the map (articleBase), not the map's own host.
  function siteHref(h, base) {
    if (!/^\/(?!\/)/.test(h) || !base) return h;
    try { return new URL(h, base).href; } catch (e) { return h; }
  }
  function miniMarkdown(md, base) {
    if (!md) return "";
    var html = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, function (m, t, h) { return '<a href="' + siteHref(h, base) + '" target="_blank" rel="noopener">' + t + "</a>"; })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return html.split(/\n{2,}/).map(function (p) { return "<p>" + p.replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  function resolveImage(ref, mediaBase) {
    if (!ref || /failed initial if statement/i.test(ref)) return null;
    // Off-site images (e.g. Flickr) are served from where they live; only the
    // legacy site's own paths were mirrored into mediaBase.
    if (/^https?:\/\//.test(ref) && !/^https?:\/\/(www\.)?auroralights\.org\//i.test(ref)) return ref;
    if (mediaBase) {
      var clean = decodeURIComponent(ref.split("?")[0].split("#")[0]);
      var bn = clean.substring(clean.lastIndexOf("/") + 1);
      return mediaBase.replace(/\/$/, "") + "/" + encodeURIComponent(bn);
    }
    if (/^https?:\/\//.test(ref)) return ref;
    return null;
  }
  // Community-resource profiles (cresources formA): image, name line, then the
  // four labelled answers and a "More" link, as InfoWindow.class.php drew them.
  var PROFILE_FIELDS = [["vision", "Vision"], ["skills", "Skills"], ["projects", "Projects"], ["resources", "Resources"]];
  function bubbleLink(p, linkBase) {
    if (!linkBase || p.id == null) return "";
    return "<p class='jucr-popup-permalink'><a href='" + linkBase + encodeURIComponent(p.id) + "' target='_blank' rel='noopener'>Link to this bubble</a></p>";
  }
  function profilePopup(p, mediaBase, articleBase) {
    var html = "<div class='jucr-popup'>";
    // Legacy drew a marker image only when img_thumb was set (InfoWindow.class.php).
    var img = p.image_thumb ? resolveImage(p.image, mediaBase) : null;
    if (img) html += "<img src='" + img + "' alt='" + (p.image_desc || "") + "' onerror=\"this.style.display='none'\">";
    if (p.meta) html += "<p class='jucr-popup-meta'>" + miniMarkdown(p.meta, articleBase).replace(/^<p>|<\/p>$/g, "") + "</p>";
    PROFILE_FIELDS.forEach(function (f) {
      if (p[f[0]]) html += "<p><b>" + f[1] + ": </b>" + miniMarkdown(p[f[0]], articleBase).replace(/^<p>|<\/p>$/g, "") + "</p>";
    });
    if (p.article_slug) html += "<p><a href='" + articleBase + p.article_slug + "' target='_blank' rel='noopener'>More</a></p>";
    return html + "</div>";
  }
  function markerPopup(p, mediaBase, articleBase, linkBase) {
    var html = markerPopupBody(p, mediaBase, articleBase);
    return html.replace(/<\/div>$/, bubbleLink(p, linkBase) + "</div>");
  }
  function markerPopupBody(p, mediaBase, articleBase) {
    if (p.form === "formA") return profilePopup(p, mediaBase, articleBase);
    var html = "<div class='jucr-popup'>";
    if (p.title) html += "<h3>" + p.title + "</h3>";
    html += miniMarkdown(p.body_md || "", articleBase);
    // Legacy drew a marker image only when img_thumb was set (InfoWindow.class.php).
    var img = p.image_thumb ? resolveImage(p.image, mediaBase) : null;
    if (img) html += "<img src='" + img + "' alt='" + (p.image_desc || "") + "' onerror=\"this.style.display='none'\">";
    if (p.details_link && p.link_to_full) html += "<p><a href='" + siteHref(p.details_link, articleBase) + "' target='_blank' rel='noopener'>Read more &rarr;</a></p>";
    return html + "</div>";
  }
  function featurePopup(props, layerLabel, base) {
    var name = props && (props.name || props.Name);
    var desc = props && props.description;
    var html = "<div class='jucr-popup'><div class='jucr-popup-layer'>" + layerLabel + "</div>";
    if (name) html += "<h3>" + name + "</h3>";
    if (desc && !/^exported from/i.test(desc)) html += "<p>" + desc.replace(/(href=["'])([^"']+)/g, function (m, a, h) { return a + siteHref(h, base); }) + "</p>";
    return html + "</div>";
  }
  function prettyLabel(s) {
    return (s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Features carry their KML styling as simplestyle properties (fill, stroke,
  // stroke-width, ...); the palette colour is only a fallback for unstyled data.
  function dominantColor(data, fallback) {
    var shapes = {}, points = {};
    (data.features || []).forEach(function (f) {
      var pr = f.properties || {}, t = (f.geometry && f.geometry.type) || "";
      // Lines carry shp2kml's unused default PolyStyle too, so take the colour
      // the geometry actually draws with. Label points never outvote shapes.
      if (/Polygon/.test(t)) { var c = pr.fill || pr.stroke; if (c) shapes[c] = (shapes[c] || 0) + 1; }
      else if (/LineString/.test(t)) { if (pr.stroke) shapes[pr.stroke] = (shapes[pr.stroke] || 0) + 1; }
      else if (pr["icon-color"]) points[pr["icon-color"]] = (points[pr["icon-color"]] || 0) + 1;
    });
    var n = Object.keys(shapes).length ? shapes : points, best = null;
    Object.keys(n).forEach(function (c) { if (!best || n[c] > n[best]) best = c; });
    return best || fallback;
  }
  function addGeoJSONLayer(map, id, data, color, label, visible, popupFor, articleBase) {
    var vis = visible ? "visible" : "none";
    // Bounding-box size per shape, so a click picks the most specific feature
    // rather than a buffer or radius drawn over everything (0 for points/lines).
    (data.features || []).forEach(function (f) {
      var g = f.geometry, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      if (!g || !/Polygon/.test(g.type)) return;
      (function walk(c) {
        if (typeof c[0] === "number") { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }
        else c.forEach(walk);
      })(g.coordinates);
      f.properties = f.properties || {}; f.properties._extent = (x1 - x0) * (y1 - y0);
    });
    map.addSource(id, { type: "geojson", data: data });
    map.addLayer({ id: id + "-fill", type: "fill", source: id,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": ["coalesce", ["get", "fill"], color],
        "fill-opacity": ["coalesce", ["get", "fill-opacity"], 0.15] }, layout: { visibility: vis } });
    map.addLayer({ id: id + "-line", type: "line", source: id,
      filter: ["in", ["geometry-type"], ["literal", ["Polygon", "LineString"]]],
      paint: { "line-color": ["coalesce", ["get", "stroke"], color],
        "line-opacity": ["coalesce", ["get", "stroke-opacity"], 1],
        "line-width": ["coalesce", ["get", "stroke-width"], 1.8] }, layout: { visibility: vis } });
    map.addLayer({ id: id + "-pt", type: "circle", source: id,
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 3.6, "circle-color": ["coalesce", ["get", "icon-color"], color], "circle-opacity": 0.85,
        "circle-stroke-width": 0.6, "circle-stroke-color": "#fff" }, layout: { visibility: vis } });
    map.addLayer({ id: id + "-label", type: "symbol", source: id,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: { "text-field": ["coalesce", ["get", "name"], ["get", "Name"], ""], "text-font": ["Open Sans Semibold"],
        "text-size": 11, "text-allow-overlap": false, "visibility": vis },
      // Dark text on a white halo: the layer colour (often yellow) vanished over its own fill.
      paint: { "text-color": "#1f1f1f", "text-halo-color": "rgba(255,255,255,0.92)", "text-halo-width": 2 } });
    var ids = [id + "-fill", id + "-line", id + "-pt", id + "-label"];
    [id + "-fill", id + "-line", id + "-pt"].forEach(function (lid) {
      popupFor[lid] = function (f) { return { html: featurePopup(f.properties, label, articleBase), maxWidth: "260px" }; };
      map.on("mouseenter", lid, function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", lid, function () { map.getCanvas().style.cursor = ""; });
    });
    return ids;
  }
  function makeToggle(label, color, checked, onChange, link) {
    var l = document.createElement("label");
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked;
    cb.addEventListener("change", function () { onChange(cb.checked); });
    var sw = document.createElement("span"); sw.className = "jucr-swatch"; sw.style.background = color;
    var tx = document.createElement("span");
    // Two legacy legend labels held an inline link (manifest `label_link`);
    // a click on a link inside a <label> follows it and leaves the box alone.
    var at = link && link.text && link.href ? label.indexOf(link.text) : -1;
    if (at < 0) tx.textContent = label;
    else {
      var a = document.createElement("a");
      a.href = link.href; a.target = "_blank"; a.rel = "noopener"; a.textContent = link.text;
      if (link.title) a.title = link.title;
      tx.appendChild(document.createTextNode(label.slice(0, at))); tx.appendChild(a);
      tx.appendChild(document.createTextNode(label.slice(at + link.text.length)));
    }
    l.appendChild(cb); l.appendChild(sw); l.appendChild(tx);
    return l;
  }

  async function initOne(container) {
    var base = container.getAttribute("data-jucr-map"); if (!base) return;
    if (base.slice(-1) !== "/") base += "/";
    var mediaBase = container.getAttribute("data-media-base") || "";
    var articleBase = container.getAttribute("data-article-base") || "/articles/";
    var linkBase = container.getAttribute("data-bubble-link") || "";
    // Legacy deep links: gmaps.php?gmap=<theme>&...&window_id=<marker id> (Q-A4CR101-1).
    var openId = container.getAttribute("data-window-id");
    if (openId == null) { try { openId = new URLSearchParams(location.search).get("window_id"); } catch (e) { openId = null; } }
    container.classList.add("jucr-map-widget");
    container.style.position = "relative";
    container.style.height = container.getAttribute("data-height") || "520px";
    var mapEl = document.createElement("div"); mapEl.className = "jucr-map-canvas"; container.appendChild(mapEl);
    var panel = document.createElement("div"); panel.className = "jucr-map-panel";
    panel.innerHTML = "<h4>Map Layers</h4>";
    var layersBox = document.createElement("div"); layersBox.className = "jucr-layers"; panel.appendChild(layersBox);
    var note = document.createElement("div"); note.className = "jucr-note";
    note.innerHTML = "Toggle layers above. Click a <strong>marker</strong> or any shape for details.";
    panel.appendChild(note);
    // Production gmaps.php's second map credit (D37a): the data-currency caveat.
    var credit = document.createElement("div"); credit.className = "jucr-credit";
    credit.textContent = "We endeavor to keep these maps up-to-date, but they will not always be as recent as primary sources.";
    panel.appendChild(credit); container.appendChild(panel);

    var manifest = await (await fetch(base + "map.json")).json();
    var map = new maplibregl.Map({ container: mapEl,
      // Polygon labels are a symbol layer, which MapLibre rejects without a glyph
      // source; without one the first labelled layer threw and aborted the rest.
      style: { version: 8, glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: { osm: { type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256,
        attribution: "© OpenStreetMap contributors" } },
        layers: [{ id: "osm", type: "raster", source: "osm" }] },
      center: manifest.center, zoom: manifest.zoom });
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    // One click opens one popup, as the legacy map's single info window did
    // (A4-hazy-G4): the story marker if one is under the cursor, otherwise the
    // most specific feature (points and lines, then the smallest shape; ties go
    // to the topmost). Per-layer handlers each opened their own, stacking 3-4.
    var popupFor = {}, popup = null;
    function openPopup(lngLat, html, maxWidth) {
      if (popup) popup.remove();
      popup = new maplibregl.Popup({ maxWidth: maxWidth }).setLngLat(lngLat).setHTML(html).addTo(map);
    }
    map.on("click", function (e) {
      var ids = Object.keys(popupFor).filter(function (lid) { return map.getLayer(lid); });
      if (!ids.length) return;
      var hits = map.queryRenderedFeatures(e.point, { layers: ids });
      var size = function (f) { return f.layer.id === "markers" ? -1 : (f.properties._extent || 0); };
      var hit = hits.reduce(function (best, f) { return !best || size(f) < size(best) ? f : best; }, null);
      if (!hit) return;
      var p = popupFor[hit.layer.id](hit);
      openPopup(e.lngLat, p.html, p.maxWidth);
    });

    map.on("load", async function () {
      for (var i = 0; i < (manifest.layers || []).length; i++) {
        var layer = manifest.layers[i];
        if (!layer.file || layer.features === 0) continue;
        var on = !!layer.default;
        var gj; try { gj = await (await fetch(base + layer.file)).json(); } catch (e) { continue; }
        var color = dominantColor(gj, PALETTE[i % PALETTE.length]);
        var ids = addGeoJSONLayer(map, "layer-" + layer.id, gj, color, layer.label || prettyLabel(layer.id), on, popupFor, articleBase);
        (function (ids) {
          layersBox.appendChild(makeToggle(layer.label || prettyLabel(layer.id), color, on, function (chk) {
            ids.forEach(function (lid) { if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", chk ? "visible" : "none"); });
          }, layer.label_link));
        })(ids);
      }
      if (manifest.markers) {
        var markers = await (await fetch(base + manifest.markers)).json();
        if (markers.features.length) {
          map.addSource("markers", { type: "geojson", data: markers });
          map.addLayer({ id: "markers", type: "circle", source: "markers",
            paint: { "circle-radius": 8, "circle-color": MARKER_COLOR, "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
          popupFor.markers = function (f) { return { html: markerPopup(f.properties, mediaBase, articleBase, linkBase), maxWidth: "300px" }; };
          // window_id: open that marker's popup at load, anchored to the marker's
          // own coordinates (production v3 anchored to a position-less object and
          // never showed it, D26). The map-level click handler stays bound.
          if (openId != null && openId !== "") {
            var hit = markers.features.filter(function (f) { return String(f.properties.id) === String(openId); })[0];
            if (hit && hit.geometry && hit.geometry.coordinates) {
              map.jumpTo({ center: hit.geometry.coordinates });
              openPopup(hit.geometry.coordinates, markerPopup(hit.properties, mediaBase, articleBase, linkBase), "300px");
            }
          }
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
