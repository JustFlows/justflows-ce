(() => {
  "use strict";

  const THEMES = new Set(["midnight", "daylight", "contrast"]);
  const THEME_KEY = "jf-debug-toolbar-theme";

  const styles = `
    :host {
      --bg: #121829; --surface: #171e31; --border: #33405e; --text: #e8ecf5;
      --muted: #a6b0c6; --brand: #a5b4fc; --accent: #4f46e5; --accent-text: #fff;
      --success: #86efac; --success-bg: rgba(34,197,94,.12); --code: #c7d2fe;
      all: initial; position: fixed; z-index: 2147483646; right: 1rem; bottom: 1rem;
      width: min(30rem, calc(100vw - 2rem)); color: var(--text); color-scheme: dark;
      font: 13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    }
    :host([data-theme="daylight"]) {
      --bg: #fff; --surface: #f8fafc; --border: #cbd5e1; --text: #0f172a;
      --muted: #475569; --brand: #4338ca; --accent: #4f46e5; --accent-text: #fff;
      --success: #166534; --success-bg: #dcfce7; --code: #3730a3; color-scheme: light;
    }
    :host([data-theme="contrast"]) {
      --bg: #000; --surface: #000; --border: #fff; --text: #fff; --muted: #fff;
      --brand: #ffeb3b; --accent: #ffeb3b; --accent-text: #000; --success: #7cff6b;
      --success-bg: #102b0c; --code: #ffeb3b; color-scheme: dark;
    }
    *, *::before, *::after { box-sizing: border-box; }
    .toolbar { overflow: hidden; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
    .toggle { display: flex; width: 100%; align-items: center; gap: .75rem; padding: .7rem .85rem; color: inherit; background: transparent; border: 0; cursor: pointer; font: inherit; }
    .toggle:focus-visible, button:focus-visible, a:focus-visible, select:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
    .toggle .chevron { margin-left: auto; }
    .brand { color: var(--brand); font-weight: 750; }
    .cache { padding: .15rem .45rem; color: var(--success); background: var(--success-bg); border-radius: 999px; font-size: 11px; }
    .panel { padding: 0 .85rem .85rem; border-top: 1px solid var(--border); }
    .panel[hidden] { display: none; }
    dl { margin: 0; }
    dl > div { display: flex; justify-content: space-between; gap: 1rem; padding: .45rem 0; border-bottom: 1px solid var(--border); }
    dt { color: var(--muted); }
    dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
    code { padding: 0; color: var(--code); background: transparent; border: 0; font: 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .copy { padding: 0; color: var(--brand); background: transparent; border: 0; cursor: pointer; font: inherit; }
    .footer { display: flex; align-items: center; gap: .65rem; flex-wrap: wrap; margin-top: .75rem; }
    .link { display: inline-flex; padding: .45rem .7rem; color: var(--accent-text); background: var(--accent); border-radius: 8px; text-decoration: none; font-weight: 650; }
    .theme-label { margin-left: auto; color: var(--muted); font-size: 11px; }
    select { padding: .35rem .5rem; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 7px; font: inherit; }
    @media (max-width: 560px) {
      :host { right: .5rem; bottom: .5rem; width: calc(100vw - 1rem); }
      dl > div { flex-direction: column; gap: .1rem; }
      dd { text-align: left; }
      .theme-label { margin-left: 0; }
    }
  `;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  class JustflowsDebugToolbar extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      let data;
      try { data = JSON.parse(this.dataset.payload || "{}"); } catch { return; }
      let stored = "midnight";
      try { stored = localStorage.getItem(THEME_KEY) || "midnight"; } catch { /* storage can be disabled */ }
      const theme = THEMES.has(stored) ? stored : "midnight";
      this.dataset.theme = theme;
      const e = escapeHtml;
      const shadow = this.attachShadow({ mode: "closed" });
      shadow.innerHTML = `<style>${styles}</style><aside class="toolbar" aria-label="Justflows debug toolbar">
        <button class="toggle" type="button" aria-expanded="true"><span class="brand">JF Debug</span><span>${e(Number(data.durationMs || 0).toFixed(1))} ms</span><span class="cache">Page ${e(data.pageCache)}${data.pageCacheReason ? ` · ${e(data.pageCacheReason)}` : ""}</span><span class="chevron" aria-hidden="true">▾</span></button>
        <div class="panel"><dl>
          <div><dt>Request ID</dt><dd><code>${e(data.requestId)}</code> <button class="copy" type="button">Copy</button></dd></div>
          <div><dt>Request time</dt><dd>${e(Number(data.durationMs || 0).toFixed(2))} ms</dd></div>
          <div><dt>Page cache</dt><dd>${e(data.pageCache)}${data.pageCacheReason ? ` · ${e(data.pageCacheReason)}` : ""}</dd></div>
          <div><dt>Object cache</dt><dd>${e(data.objectCache)}</dd></div>
          <div><dt>Database</dt><dd>${e(data.databaseQueries)} operations · ${e(Number(data.databaseMs || 0).toFixed(2))} ms</dd></div>
          <div><dt>Hooks</dt><dd>${e(data.hookRuns)} runs · ${e(data.hookErrors)} errors</dd></div>
          <div><dt>Site theme</dt><dd><code>${e(data.theme)}</code></dd></div>
          <div><dt>Template</dt><dd><code>${e(data.template)}</code></dd></div>
        </dl><div class="footer"><a class="link" href="${e(data.diagnosticsUrl)}">Open Diagnostics</a><label class="theme-label" for="jf-debug-theme">Toolbar theme</label><select id="jf-debug-theme"><option value="midnight">Midnight</option><option value="daylight">Daylight</option><option value="contrast">High contrast</option></select></div></div>
      </aside>`;
      const toggle = shadow.querySelector(".toggle");
      const panel = shadow.querySelector(".panel");
      const select = shadow.querySelector("select");
      select.value = theme;
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!open));
        panel.hidden = open;
      });
      shadow.querySelector(".copy").addEventListener("click", async (event) => {
        try { await navigator.clipboard.writeText(String(data.requestId || "")); event.currentTarget.textContent = "Copied"; }
        catch { event.currentTarget.textContent = "Copy failed"; }
      });
      select.addEventListener("change", () => {
        const next = THEMES.has(select.value) ? select.value : "midnight";
        this.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch { /* keep the in-page selection */ }
      });
    }
  }

  if (!customElements.get("jf-debug-toolbar")) customElements.define("jf-debug-toolbar", JustflowsDebugToolbar);
})();
