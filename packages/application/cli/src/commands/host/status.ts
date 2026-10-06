// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the Host status command.
 * @module commands/host/status
 */

import { BaseCommand, type CommonFlags } from "../../base-command.js";

/** Reads the current Product Host identity and state. */
export default class HostStatus extends BaseCommand {
  static summary = "Read the current Host identity and state";

  /** Executes the Host status command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(HostStatus);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(common["anchor-root"], (local) => local.client.getHost(), true);
  }
}
