// SPDX-License-Identifier: MIT

import { createPasskey, isCancelled, passkeysSupported, type CreationOptionsJson } from "../../admin-ui/src/lib/webauthn";

(() => {
  type Site = { id: string; name: string; status: string; url: string | null };
  type Workspace = { id: string; name: string; status: string; userMode: string; sites: Site[] };

  type Meter = { key: string; label: string; unit: string; limit: number | null; used: number | null };
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = "") => {
    const node = document.createElement(tag); node.textContent = text; node.className = cls; return node;
  };
  const notice = (text: string) => { const message = get("account-message"); if (message) message.textContent = text; };
  const selector = get<HTMLSelectElement>("workspace-select");
  const resourceSelector = get<HTMLSelectElement>("resource-select");
  let workspaces: Workspace[] = [];
  let domain: string | null = null;
  let resourceRequest = 0;
  const current = () => workspaces.find((workspace) => workspace.id === selector.value);
  const workspaceUrl = () => `/api/account/workspaces/${encodeURIComponent(current()!.id)}`;

  async function request<T>(url: string, method = "GET", body?: object): Promise<T> {
    const csrf = document.cookie.split("; ").find((cookie) => cookie.startsWith("jf_csrf="))?.slice(8) ?? "";
    const res = await fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 401) { window.location.assign("/login"); throw new Error("Please sign in again."); }
    let data: T & { error?: string };
    try { data = await res.json(); } catch { throw new Error("The request could not be completed. Please try again."); }
    if (!res.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }
  async function saving(form: HTMLFormElement, action: () => Promise<void>) {
    const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button"));
    buttons.forEach((button) => { button.disabled = true; });
    notice("");
    try { await action(); } catch (error) { notice(error instanceof Error ? error.message : "Please try again."); }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  }
  function renderSites(workspace: Workspace) {
    const host = get("site-list"); host.replaceChildren();
    if (!workspace.sites.length) host.append(make("p", "No sites in this workspace yet.", "muted"));
    for (const site of workspace.sites) {
      const row = make("article", "", "site-row"); const details = make("div");
      details.append(make("h3", site.name), make("p", site.url || "No site address", "muted"), make("span", site.status, "badge"));
      const actions = make("div", "", "site-actions");
      if (site.url && site.status === "active") {
        // Administration sign-in goes through the account API, which resolves the
        // site's own (possibly hidden) admin path for the verified owner only.
        const adminSignIn = `${workspaceUrl()}/sites/${encodeURIComponent(site.id)}/admin-sign-in`;
        for (const [href, label] of [[site.url, "Visit site ↗"], [adminSignIn, "Admin sign-in ↗"]]) {
          const link = make("a", label); link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; actions.append(link);
        }
      }
      const rename = make("button", "Rename", "secondary"); rename.type = "button";
      const form = make("form"); form.hidden = true;
      const input = make("input"); input.name = "name"; input.value = site.name; input.required = true; input.maxLength = 255; input.setAttribute("aria-label", "Site name");
      const save = make("button", "Save"); save.type = "submit";
      const cancel = make("button", "Cancel", "secondary"); cancel.type = "button"; cancel.onclick = () => { form.hidden = true; rename.hidden = false; };
      form.append(input, save, cancel); rename.onclick = () => { form.hidden = false; rename.hidden = true; input.focus(); };
      form.onsubmit = (event) => { event.preventDefault(); void saving(form, async () => { await request(`${workspaceUrl()}/sites/${encodeURIComponent(site.id)}`, "PATCH", { name: input.value }); await loadAccount(); notice("Site name saved."); }); };
      actions.append(rename); details.append(form); row.append(details, actions); host.append(row);
    }
  }
  async function loadResources() {
    const serial = ++resourceRequest;
    const host = get("resource-list"); host.replaceChildren(make("p", "Loading resources…", "muted"));
    if (!current()) return;
    const selected = resourceSelector.value;
    const path = selected === "workspace" ? `${workspaceUrl()}/limits` : `${workspaceUrl()}/sites/${encodeURIComponent(selected)}/limits`;
    try {
      const data = await request<{ meters: Meter[] }>(path);
      if (serial !== resourceRequest) return;
      host.replaceChildren(); const grid = make("div", "", "resource-grid");
      for (const meter of data.meters) {
        const card = make("div", "", "resource-card");
        const format = (n: number) => meter.unit === "bytes" ? `${(n / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB` : n.toLocaleString();
        const value = meter.unit === "flag" ? (meter.limit === 0 ? "Not included" : "Included") : `${meter.used === null ? "Usage unavailable" : format(meter.used)} / ${meter.limit === null ? "Unlimited" : format(meter.limit)}`;
        card.append(make("p", meter.label), make("strong", value)); grid.append(card);
      }
      host.append(grid);
    } catch (error) { if (serial === resourceRequest) host.replaceChildren(make("p", error instanceof Error ? error.message : "Resources unavailable.", "muted")); }
  }
  function renderWorkspace(loadMeters = true) {
    const workspace = current(); if (!workspace) return;
    get("workspace-status").textContent = workspace.status;
    get<HTMLInputElement>("workspace-name").value = workspace.name;
    get("workspace-id").textContent = workspace.id;
    get<HTMLButtonElement>("show-new-site").disabled = workspace.status !== "active" || !domain;
    get<HTMLFormElement>("new-site-form").hidden = true;
    get("site-domain").textContent = domain ? `.${domain}` : "";
    renderSites(workspace);
    resourceSelector.replaceChildren(new Option("Workspace", "workspace"), ...workspace.sites.map((site) => new Option(site.name, site.id)));
    if (loadMeters) void loadResources();
  }
  async function loadAccount() {
    const previous = selector.value;
    const data = await request<{ workspaces: Workspace[]; siteDomain: string | null }>("/api/account/workspaces");
    workspaces = data.workspaces; domain = data.siteDomain;
    selector.replaceChildren(...workspaces.map((workspace) => new Option(workspace.name, workspace.id)));
    if (workspaces.some((workspace) => workspace.id === previous)) selector.value = previous;
    get("account-content").hidden = !workspaces.length;
    if (workspaces.length) renderWorkspace();
  }
  if (selector) {
    selector.onchange = () => renderWorkspace();
    resourceSelector.onchange = () => void loadResources();
    const nameForm = get<HTMLFormElement>("workspace-name-form");
    nameForm.onsubmit = (event) => { event.preventDefault(); void saving(nameForm, async () => { await request(workspaceUrl(), "PATCH", { name: get<HTMLInputElement>("workspace-name").value }); await loadAccount(); notice("Workspace name saved."); }); };
    const siteForm = get<HTMLFormElement>("new-site-form");
    get("show-new-site").onclick = () => { siteForm.hidden = false; siteForm.querySelector("input")?.focus(); };
    get("cancel-new-site").onclick = () => { siteForm.hidden = true; siteForm.reset(); };
    siteForm.onsubmit = (event) => { event.preventDefault(); void saving(siteForm, async () => { const fields = new FormData(siteForm); await request(`${workspaceUrl()}/sites`, "POST", { name: fields.get("name"), address: fields.get("address"), password: fields.get("password") }); siteForm.reset(); await loadAccount(); notice("Your new site is ready."); }); };
  }
  const signOut = get<HTMLButtonElement>("sign-out");
  if (signOut) signOut.onclick = async () => { try { await request("/api/auth/logout", "POST", {}); window.location.assign("/login"); } catch (error) { notice(error instanceof Error ? error.message : "Could not sign out."); } };
  const initial = JSON.parse(get("initial-account").textContent || "{}") as { workspaces: Workspace[]; siteDomain: string | null };
  workspaces = initial.workspaces; domain = initial.siteDomain;
  if (workspaces.length && selector) renderWorkspace(false);
  /**
   * Passkeys (#105). Adding or removing one asks for the password, so a
   * borrowed session cannot change how the account signs in. Recovery codes
   * are shown once, when the first passkey creates them.
   */
  type Passkey = { id: string; name: string; createdAt: string | null; lastUsedAt: string | null; synced: boolean };
  type PasskeyStatus = { passkeys: Passkey[]; mode: "allow" | "require" | "disallow"; maxPasskeys: number; recoveryCodesRemaining: number | null; totpEnabled: boolean };
  const passkeyHost = document.querySelector<HTMLElement>("[data-jf-passkeys]");
  async function renderPasskeys(codes?: string[]): Promise<void> {
    if (!passkeyHost) return;
    let status: PasskeyStatus;
    try { status = await request<PasskeyStatus>("/api/auth/passkeys"); } catch (error) {
      passkeyHost.replaceChildren(make("p", error instanceof Error ? error.message : "Passkeys could not be loaded.", "muted"));
      return;
    }
    passkeyHost.replaceChildren();
    if (codes) {
      const box = make("div", "", "account-card");
      box.append(make("h3", "Save your recovery codes"),
        make("p", "Each code works once. Keep them somewhere you can reach without this device: with your password, a code signs you in if you lose your passkeys. This is the only time they are shown."),
        make("pre", codes.join("\n")));
      const done = make("button", "I have saved them"); done.type = "button"; done.onclick = () => void renderPasskeys();
      box.append(done); passkeyHost.append(box);
      return;
    }
    const enrol = new URLSearchParams(window.location.search).get("enrol") === "passkey";
    if (status.mode === "require" && !status.passkeys.length || enrol && !status.passkeys.length && status.mode !== "disallow") {
      passkeyHost.append(make("p", "Your account must use a passkey on this site. Add one to keep signing in.", "notice"));
    }
    if (status.mode === "disallow") passkeyHost.append(make("p", "Passkeys are turned off for your account on this site.", "muted"));
    else if (!passkeysSupported()) passkeyHost.append(make("p", "This browser cannot use passkeys.", "muted"));
    const list = make("div", "", "account-grid");
    if (!status.passkeys.length) list.append(make("p", "No passkeys yet.", "muted"));
    const when = (value: string | null) => value ? new Date(value).toLocaleString() : "";
    const form = make("form"); form.hidden = true;
    const formTitle = make("h3");
    const nameInput = make("input"); nameInput.maxLength = 100; nameInput.placeholder = "Name, for example Work laptop"; nameInput.setAttribute("aria-label", "Passkey name");
    const passwordInput = make("input"); passwordInput.type = "password"; passwordInput.autocomplete = "current-password"; passwordInput.required = true; passwordInput.setAttribute("aria-label", "Current password"); passwordInput.placeholder = "Current password";
    const others = make("input"); others.type = "checkbox"; others.checked = true;
    const othersLabel = make("label", " Also sign out every other device"); othersLabel.prepend(others);
    const submit = make("button"); submit.type = "submit";
    const cancel = make("button", "Cancel", "secondary"); cancel.type = "button"; cancel.onclick = () => { form.hidden = true; };
    form.append(formTitle, nameInput, passwordInput, othersLabel, submit, cancel);
    let action: () => Promise<void> = async () => undefined;
    const open = (title: string, label: string, withName: boolean, withOthers: boolean, run: () => Promise<void>) => {
      formTitle.textContent = title; submit.textContent = label; nameInput.hidden = !withName; othersLabel.hidden = !withOthers;
      passwordInput.value = ""; nameInput.value = ""; action = run; form.hidden = false; (withName ? nameInput : passwordInput).focus();
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      void saving(form, async () => {
        try { await action(); } catch (error) { if (!isCancelled(error)) throw error; }
      });
    };
    for (const passkey of status.passkeys) {
      const card = make("article", "", "account-card");
      card.append(make("h3", passkey.name),
        make("p", `${passkey.synced ? "Synced" : "This device or key only"} · added ${when(passkey.createdAt)} · ${passkey.lastUsedAt ? `last used ${when(passkey.lastUsedAt)}` : "never used"}`, "muted"));
      const actions = make("div", "", "account-actions");
      const rename = make("button", "Rename", "secondary"); rename.type = "button";
      rename.onclick = () => {
        const next = window.prompt("New name for this passkey", passkey.name)?.trim();
        if (!next) return;
        void request(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}`, "PATCH", { name: next })
          .then(() => { notice("Passkey renamed."); return renderPasskeys(); })
          .catch((error) => notice(error instanceof Error ? error.message : "Could not rename the passkey."));
      };
      const remove = make("button", "Remove", "secondary"); remove.type = "button";
      remove.onclick = () => open(`Remove ${passkey.name}`, "Remove passkey", false, true, async () => {
        const result = await request<{ signedOut: number }>(`/api/auth/passkeys/${encodeURIComponent(passkey.id)}/revoke`, "POST", { password: passwordInput.value, signOutOthers: others.checked });
        notice(result.signedOut > 0 ? `Passkey removed. ${result.signedOut} other sessions were signed out.` : "Passkey removed.");
        await renderPasskeys();
      });
      actions.append(rename, remove); card.append(actions); list.append(card);
    }
    passkeyHost.append(list);
    if (status.mode !== "disallow" && passkeysSupported() && status.passkeys.length < status.maxPasskeys) {
      const add = make("button", "Add a passkey"); add.type = "button";
      add.onclick = () => open("Add a passkey", "Add passkey", true, false, async () => {
        const options = await request<CreationOptionsJson>("/api/auth/passkeys/register/options", "POST", { password: passwordInput.value });
        const credential = await createPasskey(options);
        const result = await request<{ recoveryCodes?: string[] }>("/api/auth/passkeys/register/verify", "POST", { ceremonyId: options.ceremonyId, credential, ...(nameInput.value.trim() ? { name: nameInput.value.trim() } : {}) });
        notice("Passkey added.");
        await renderPasskeys(result.recoveryCodes);
      });
      passkeyHost.append(add);
    }
    const remaining = status.recoveryCodesRemaining;
    passkeyHost.append(make("p", remaining === null ? "Recovery codes could not be read." : remaining > 0
      ? `${remaining} unused recovery codes left.` : "No recovery codes yet. They are created with your first passkey.", "muted"));
    if (status.passkeys.length || status.totpEnabled) {
      const regenerate = make("button", "Create new recovery codes", "secondary"); regenerate.type = "button";
      regenerate.onclick = () => open("Create new recovery codes", "Create new codes", false, false, async () => {
        const result = await request<{ recoveryCodes: string[] }>("/api/auth/recovery-codes/regenerate", "POST", { password: passwordInput.value });
        await renderPasskeys(result.recoveryCodes);
      });
      passkeyHost.append(regenerate);
    }
    passkeyHost.append(form,
      make("p", "Lost a passkey? Remove it here. If you cannot sign in, use your password with a recovery code, or ask the site's administrator to remove your passkeys.", "muted"));
  }
  void renderPasskeys();

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-account-action]")) {
    button.onclick = async () => {
      if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
      button.disabled = true;
      try { await request(button.dataset.accountAction!, "POST", {}); window.location.reload(); }
      catch (error) { notice(error instanceof Error ? error.message : "Could not update your account."); button.disabled = false; }
    };
  }
})();
