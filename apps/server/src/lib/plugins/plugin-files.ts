// SPDX-License-Identifier: MIT

import type { PluginFilesApi } from "@justflows/sdk";
import {
  deletePrivateFile,
  getPrivateFile,
  listPrivateFiles,
  putPrivateFile,
  readPrivateFile,
} from "../files/private-storage.js";
import { pluginCallSiteId } from "./request-site.js";

/** `ctx.files`: the plugin's private files on the site of the current call. */
export function createPluginFilesApi(pluginId: string, activatedSiteId: string): PluginFilesApi {
  const site = () => pluginCallSiteId(activatedSiteId);
  return {
    put: (key, data, options) => {
      if (!Buffer.isBuffer(data)) return Promise.reject(new Error("ctx.files.put needs a Buffer."));
      return putPrivateFile(site(), pluginId, key, data, options?.contentType ?? "application/octet-stream");
    },
    get: (key) => getPrivateFile(site(), pluginId, key),
    read: (key) => readPrivateFile(site(), pluginId, key),
    delete: (key) => deletePrivateFile(site(), pluginId, key),
    list: (prefix) => listPrivateFiles(site(), pluginId, prefix ?? ""),
  };
}
