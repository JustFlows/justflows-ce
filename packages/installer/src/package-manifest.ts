import { z } from "zod";
import {
  AdminMenuItemSchema,
  gplLicenseValidationMessage,
  isGplCompatibleLicense,
} from "@justflows/sdk";

const CssAssetSchema = z.object({
  href: z.string().optional(),
  src: z.string().optional(),
  integrity: z.string().optional(),
  crossOrigin: z.enum(["anonymous", "use-credentials"]).optional(),
  defer: z.boolean().optional(),
});

/** Unified manifest schema for plugins, themes, and css-providers (.jfpkg) */
export const PackageManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.enum(["plugin", "theme", "css-provider"]),
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/, "ID must be dot-namespaced e.g. acme.my-plugin"),
    name: z.string().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+/),
    publisher: z.string().min(1),
    description: z.string().max(500).optional(),
    license: z
      .string()
      .min(1, "Package license is required and must be GPL-compatible"),
    homepage: z.url().optional(),
    /** Semver range for Justflows compatibility */
    justflows: z.string().optional(),
    /** Plugin-only: server entrypoint path within the package */
    entrypoints: z
      .object({
        server: z.string().optional(),
        admin: z.string().optional(),
      })
      .optional(),
    /** Theme-only: theme entrypoint */
    entrypoint: z.string().optional(),
    /** CSS-provider-only: npm packages installed locally on activation */
    stylesheets: z.array(CssAssetSchema).default([]),
    /** CSS-provider-only: optional scripts loaded from installed packages */
    scripts: z.array(CssAssetSchema).default([]),
    permissions: z.array(z.string()).default([]),
    dependencies: z.record(z.string(), z.string()).default({}),
    settingsSchema: z
      .record(
        z.string(),
        z.object({
          type: z.enum(["string", "number", "boolean", "text"]),
          label: z.string().min(1),
          description: z.string().optional(),
          default: z.unknown().optional(),
          localized: z.boolean().optional(),
        }),
      )
      .optional(),
    /**
     * Plugin-only: admin sidebar entries the package owns. Kept here so the
     * declaration survives install and can be re-read from the stored manifest.
     */
    adminMenu: z.array(AdminMenuItemSchema).max(10).optional(),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.adminMenu?.length && !manifest.permissions.includes("admin:extend")) {
      ctx.addIssue({
        code: "custom",
        path: ["adminMenu"],
        message: 'Contributing admin menu items requires the "admin:extend" permission',
      });
    }
    if (!isGplCompatibleLicense(manifest.license)) {
      ctx.addIssue({
        code: "custom",
        path: ["license"],
        message: gplLicenseValidationMessage(manifest.license),
      });
    }
  });

export type PackageManifest = z.infer<typeof PackageManifestSchema>;
