// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the readiness command.
 * @module commands/readiness
 */

import { BaseCommand, type CommonFlags } from "../base-command.js";

/** Reads current Product Host readiness. */
export default class Readiness extends BaseCommand {
  static summary = "Read current runtime readiness";

  /** Executes the readiness command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(Readiness);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      (local) => local.client.getReadiness(),
      true,
    );
  }
}
