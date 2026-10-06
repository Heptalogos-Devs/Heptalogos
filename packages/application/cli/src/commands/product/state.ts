// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the current Product prerequisite state command.
 * @module commands/product/state
 */

import { BaseCommand, type CommonFlags } from "../../base-command.js";

/** Reads configuration, Secret metadata, NetworkAccess, and AIRuntime state. */
export default class ProductState extends BaseCommand {
  static summary = "Read current Product prerequisite state";

  /** Executes the Product state command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(ProductState);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      (local) => local.client.getProductState(),
      true,
    );
  }
}
