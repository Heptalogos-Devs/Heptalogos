// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the aggregate status command.
 * @module commands/status
 */

import { BaseCommand, type CommonFlags } from "../base-command.js";

/** Reads aggregate Product Host status. */
export default class Status extends BaseCommand {
  static summary = "Read aggregate Product Host status";

  /** Executes the status command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(Status);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      (local) => local.client.getSystemStatus(),
      true,
    );
  }
}
