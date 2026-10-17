// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-party QQ channel entry for the independently installed native OpenClaw runtime.
 * @packageDocumentation
 */
import {
  definePluginEntry,
  buildJsonPluginConfigSchema,
} from "openclaw/plugin-sdk/plugin-entry";
import { nativePluginConfigSchema } from "./config.js";
import { registerQqChannel } from "./runtime.js";
export { resolveQqNativeRoute } from "./routing.js";
export default definePluginEntry({
  id: "heptalogos-qq",
  name: "Heptalogos QQ",
  description: "Host-governed QQ ingress and physical delivery",
  configSchema: buildJsonPluginConfigSchema(
    Object.fromEntries(Object.entries(nativePluginConfigSchema)),
  ),
  register: registerQqChannel,
});
