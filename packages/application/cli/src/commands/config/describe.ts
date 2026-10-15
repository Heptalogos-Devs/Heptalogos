// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Deterministic product configuration command.
 * @module commands/config
 */
import { BaseCommand, type CommonFlags } from "../../base-command.js";
/** Reads configuration from the owning API. */
export default class ConfigurationDescribe extends BaseCommand {
  static summary = "Describe product configuration";
  /** Prints the schema owned by the Management API. */
  async run() {
    const { flags } = await this.parse(ConfigurationDescribe);
    return this.execute(
      (flags as typeof flags & CommonFlags)["anchor-root"],
      (local) => local.client.describeConfiguration(),
      true,
    );
  }
}
