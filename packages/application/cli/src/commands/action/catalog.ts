// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the current SystemAction catalog command.
 * @module commands/action/catalog
 */

import { BaseCommand, type CommonFlags } from "../../base-command.js";

/** Reads the finite current Management SystemAction catalog. */
export default class ActionCatalog extends BaseCommand {
  static summary = "Read the current SystemAction catalog";

  /** Executes the catalog command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(ActionCatalog);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      (local) => local.client.getSystemActionCatalog(),
      true,
    );
  }
}
