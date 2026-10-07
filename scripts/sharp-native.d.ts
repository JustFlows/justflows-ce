// Types for sharp-native.js, which the server tests import.

export interface SharpPackageSpec {
  name: string;
  version: string;
  spec: string;
}

export interface SharpLockPackage {
  name: string;
  version: string;
}

export function sharpRuntimeId(platform: string, arch: string, musl: boolean): string;

export function sharpNativePackageNames(runtimeId: string): string[];

export function missingSharpPackages(
  optionalDependencies: Record<string, string> | null | undefined,
  runtimeId: string,
  installedVersions: Record<string, string | null> | null | undefined,
): SharpPackageSpec[];

export function omittedSharpLockPackages(
  packages: Record<string, { optionalDependencies?: Record<string, string> } & Record<string, unknown>> | null | undefined,
): SharpLockPackage[];
