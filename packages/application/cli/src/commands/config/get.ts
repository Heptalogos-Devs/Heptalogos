// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Deterministic product configuration command.
 * @module commands/config
 */
import { BaseCommand, type CommonFlags } from "../../base-command.js";
/** Reads configuration from the owning API. */
export default class ConfigurationGet extends BaseCommand {
  static summary = "Get product configuration";
  /** Reads effective settings and their CAS revision. */
  async run() {
    const { flags } = await this.parse(ConfigurationGet);
    return this.execute(
      (flags as typeof flags & CommonFlags)["anchor-root"],
      (local) => local.client.getConfiguration(),
      true,
    );
  }
}
