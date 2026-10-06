// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the Management contract command.
 * @module commands/contract
 */

import { BaseCommand, type CommonFlags } from "../base-command.js";

/** Reads the current Management contract descriptor. */
export default class Contract extends BaseCommand {
  static summary = "Read the current Management contract descriptor";

  /** Executes the contract command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(Contract);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(common["anchor-root"], (local) => local.client.getDiscovery());
  }
}
