// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the Runtime graph command.
 * @module commands/runtime/graph
 */

import { BaseCommand, type CommonFlags } from "../../base-command.js";

/** Reads the current Runtime graph. */
export default class RuntimeGraph extends BaseCommand {
  static summary = "Read the current Runtime graph";

  /** Executes the Runtime graph command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(RuntimeGraph);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      (local) => local.client.getRuntimeGraph(),
      true,
    );
  }
}
