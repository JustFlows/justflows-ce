/**
 * sharp's native binary is an optional package (@img/sharp-linux-x64 and the
 * matching libvips package). A hosting lockfile can list those names on the
 * sharp entry and still omit the resolved packages, so `npm install` never
 * downloads the binary for the machine that is actually running.
 */

export function sharpRuntimeId(platform, arch, musl) {
  if (platform === "linux" && musl && (arch === "x64" || arch === "arm64")) {
    return `linuxmusl-${arch}`;
  }
  if (platform === "freebsd" && (arch === "x64" || arch === "arm64")) {
    return "freebsd-wasm32";
  }
  return `${platform}-${arch}`;
}

export function sharpNativePackageNames(runtimeId) {
  if (runtimeId === "freebsd-wasm32") return ["@img/sharp-freebsd-wasm32"];
  if (runtimeId === "linux-wasm32") return ["@img/sharp-webcontainers-wasm32"];
  return [`@img/sharp-${runtimeId}`, `@img/sharp-libvips-${runtimeId}`];
}

/** `{ name, version, spec }[]` for this machine that sharp declared and that are not installed at that version. */
export function missingSharpPackages(optionalDependencies, runtimeId, installedVersions) {
  const missing = [];
  for (const name of sharpNativePackageNames(runtimeId)) {
    const version = optionalDependencies?.[name];
    if (typeof version !== "string" || version.length === 0) continue;
    const installed = installedVersions?.[name] ?? null;
    if (installed === version) continue;
    missing.push({ name, version, spec: `${name}@${version}` });
  }
  return missing;
}

function isSharpPackageKey(key) {
  return key === "node_modules/sharp" || key.endsWith("/node_modules/sharp");
}

function lockfileHasPackage(packages, name) {
  const suffix = `node_modules/${name}`;
  return Object.keys(packages).some((key) => key === suffix || key.endsWith(`/${suffix}`));
}

/**
 * Platform packages named on a locked sharp entry but absent as their own
 * lockfile entries. `npm install` will not fetch those.
 */
export function omittedSharpLockPackages(packages) {
  const omitted = [];
  const seen = new Set();
  for (const [key, entry] of Object.entries(packages ?? {})) {
    if (!isSharpPackageKey(key)) continue;
    const optional = entry?.optionalDependencies ?? {};
    for (const [name, version] of Object.entries(optional)) {
      if (!name.startsWith("@img/sharp-") || seen.has(name)) continue;
      if (typeof version !== "string" || version.length === 0) continue;
      if (lockfileHasPackage(packages, name)) continue;
      seen.add(name);
      omitted.push({ name, version });
    }
  }
  return omitted;
}
