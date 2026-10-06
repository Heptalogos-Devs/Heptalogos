// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the capability graph command.
 * @module commands/capability/graph
 */

import { BaseCommand, type CommonFlags } from "../../base-command.js";

/** Reads the current capability graph. */
export default class CapabilityGraph extends BaseCommand {
  static summary = "Read the current capability graph";

  /** Executes the capability graph command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(CapabilityGraph);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      (local) => local.client.getCapabilityGraph(),
      true,
    );
  }
}
