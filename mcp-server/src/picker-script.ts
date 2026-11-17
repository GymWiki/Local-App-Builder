/**
 * Het script dat Studio ALLEEN in de preview injecteert (nooit in het project zelf).
 * Het doet niets totdat Studio het aanzet met postMessage({ type: "studio-picker", on: true }).
 * Aan: onderdelen worden omlijnd bij aanwijzen; een klik meldt het onderdeel aan Studio ({ type: "studio-pick", … }) en doet verder niets op de pagina.
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
    var r = el.getBoundingClientRect();
    var text = (el.innerText || el.textContent || el.getAttribute("alt") || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120);
    window.parent.postMessage({ type: "studio-pick", selector: cssPath(el), tag: el.tagName.toLowerCase(), text: text, path: location.pathname + location.search, rect: { x: r.left, y: r.top, width: r.width, height: r.height } }, "*");
    setOn(false);
  }, true);
  document.addEventListener("keydown", function (e) {
    if (on && e.key === "Escape") { setOn(false); window.parent.postMessage({ type: "studio-pick-cancel" }, "*"); }
  }, true);
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.type !== "studio-picker") return;
    setOn(e.data.on);
  });
  window.__studioPicker = { cssPath: cssPath };
  window.parent.postMessage({ type: "studio-picker-ready" }, "*");
})();`;
