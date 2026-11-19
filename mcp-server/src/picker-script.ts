/**
 * Het script dat Studio ALLEEN in de preview injecteert (nooit in het project zelf).
 * Het doet niets totdat Studio het aanzet met postMessage({ type: "studio-picker", on: true }).
 * Aan: onderdelen worden omlijnd bij aanwijzen; een klik meldt het onderdeel aan Studio ({ type: "studio-pick", … }) en doet verder niets op de pagina.
 * Studio kan ook vragen om een ander onderdeel (ouder of kind) te melden ({ type: "studio-picker-select", selector }) en om gegevens
 * van de pagina ({ type: "studio-picker-page" }). Het script leest alleen; het verandert nooit iets aan de pagina behalve de omlijning.
 */
export const PICKER_SCRIPT = String.raw`(function () {
  if (window.__studioPicker) return;
  var on = false;
  var box = null;
  var label = null;
  function cssPath(el) {
    if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var part = node.tagName.toLowerCase();
      if (node === document.body) { parts.unshift(part); break; }
      var cls = Array.prototype.filter.call(node.classList, function (c) { return /^[A-Za-z][A-Za-z-]{1,24}$/.test(c); })[0];
      if (cls) part += "." + CSS.escape(cls);
      var sibs = node.parentNode ? Array.prototype.filter.call(node.parentNode.children, function (s) { return s.tagName === node.tagName; }) : [];
      if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      parts.unshift(part);
      var sel = parts.join(" > ");
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) { /* ga door */ }
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  function nameOf(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) return s + "#" + el.id;
    var c = Array.prototype.filter.call(el.classList, function (x) { return /^[A-Za-z][A-Za-z-]{1,24}$/.test(x); })[0];
    return c ? s + "." + c : s;
  }
  function breadcrumb(el) {
    var out = [];
    var n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement && out.length < 12) {
      out.unshift({ label: nameOf(n), selector: cssPath(n) });
      n = n.parentElement;
    }
    return out;
  }
  function tokensOf(el) {
    var out = [];
    var seen = {};
    function add(prop, val) {
      var re = /var\((--[A-Za-z0-9_-]+)/g;
      var m;
      while ((m = re.exec(val)) !== null) {
        var key = prop + "|" + m[1];
        if (!seen[key] && out.length < 30) { seen[key] = 1; out.push({ prop: prop, token: m[1] }); }
      }
    }
    function visit(rules) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.cssRules && !r.selectorText) { visit(r.cssRules); continue; }
        if (!r.selectorText || !r.style) continue;
        try { if (!el.matches(r.selectorText)) continue; } catch (e) { continue; }
        // cssText bewaart ook samengestelde eigenschappen (zoals background) met var(), die anders als lege delen terugkomen.
        var decl = /([a-z-]+)\s*:\s*([^;]+)/gi;
        var dm;
        while ((dm = decl.exec(r.style.cssText || "")) !== null) add(dm[1].toLowerCase(), dm[2]);
      }
    }
    for (var k = 0; k < document.styleSheets.length; k++) {
      try { visit(document.styleSheets[k].cssRules); } catch (e) { /* stylesheet van een andere herkomst: overslaan */ }
    }
    var inline = el.getAttribute("style");
    if (inline) add("style", inline);
    return out;
  }
  function kitOf(el) {
    var n = el;
    while (n && n.nodeType === 1) {
      var slot = n.getAttribute("data-slot") || n.getAttribute("data-kit");
      if (slot) return { name: slot, self: n === el };
      n = n.parentElement;
    }
    return null;
  }
  function describe(el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var kids = Array.prototype.filter.call(el.children, function (c) { return !c.hasAttribute("data-studio-picker"); });
    var text = (el.innerText || el.textContent || el.getAttribute("alt") || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      type: "studio-pick",
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: text,
      path: location.pathname + location.search,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      info: {
        size: { width: Math.round(r.width), height: Math.round(r.height) },
        styles: {
          color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily.split(",")[0].trim().replace(/["']/g, ""), borderRadius: cs.borderRadius,
          padding: cs.padding, margin: cs.margin, gap: cs.gap, display: cs.display, opacity: cs.opacity
        },
        tokens: tokensOf(el),
        kit: kitOf(el),
        breadcrumb: breadcrumb(el),
        children: kids.slice(0, 12).map(function (c) { return { label: nameOf(c), selector: cssPath(c) }; }),
        childCount: kids.length,
        hidden: cs.display === "none" || cs.visibility === "hidden"
      }
    };
  }
  function ensureBox() {
    if (box) return;
    box = document.createElement("div");
    box.setAttribute("data-studio-picker", "");
    box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4f46e5;background:rgba(79,70,229,.12);border-radius:3px;display:none;transition:none";
    label = document.createElement("div");
    label.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;background:#4f46e5;color:#fff;font:12px system-ui,sans-serif;padding:2px 6px;border-radius:3px;display:none";
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(label);
  }
  function target(e) {
    var el = e.target;
    return el && el.nodeType === 1 && !el.hasAttribute("data-studio-picker") ? el : null;
  }
  function show(el) {
    ensureBox();
    var r = el.getBoundingClientRect();
    box.style.cssText += ";display:block;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px";
    label.textContent = el.tagName.toLowerCase();
    label.style.display = "block";
    label.style.left = Math.max(0, r.left) + "px";
    label.style.top = Math.max(0, r.top - 20) + "px";
  }
  function hide() { if (box) box.style.display = "none"; if (label) label.style.display = "none"; }
  function setOn(v) {
    on = !!v;
    if (!on) hide();
    document.documentElement.style.cursor = on ? "crosshair" : "";
  }
  document.addEventListener("mousemove", function (e) { if (!on) return; var el = target(e); if (el) show(el); }, true);
  document.addEventListener("click", function (e) {
    if (!on) return;
    var el = target(e);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    window.parent.postMessage(describe(el), "*");
    setOn(false);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (on && e.key === "Escape") { setOn(false); window.parent.postMessage({ type: "studio-pick-cancel" }, "*"); }
  }, true);
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data) return;
    if (e.data.type === "studio-picker") { setOn(e.data.on); return; }
    if (e.data.type === "studio-picker-select" && typeof e.data.selector === "string") {
      var el = null;
      try { el = document.querySelector(e.data.selector.slice(0, 500)); } catch (err) { el = null; }
      if (el && el.nodeType === 1 && !el.hasAttribute("data-studio-picker")) {
        show(el);
        window.parent.postMessage(describe(el), "*");
      }
      return;
    }
    if (e.data.type === "studio-picker-clear") { hide(); return; }
    if (e.data.type === "studio-picker-page") {
      var cs = getComputedStyle(document.body);
      window.parent.postMessage({ type: "studio-page", title: document.title || "", path: location.pathname + location.search, lang: document.documentElement.lang || "", width: window.innerWidth, height: window.innerHeight,
        background: cs.backgroundColor, color: cs.color, fontFamily: cs.fontFamily.split(",")[0].trim().replace(/["']/g, "") }, "*");
    }
  });
  window.__studioPicker = { cssPath: cssPath };
  window.parent.postMessage({ type: "studio-picker-ready" }, "*");
})();`;
