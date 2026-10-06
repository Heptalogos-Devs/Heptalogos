// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the Administrator logout command.
 * @module commands/auth/logout
 */

import { BaseCommand, type CommonFlags } from "../../base-command.js";

/** Revokes and removes the current local Administrator session. */
export default class AuthLogout extends BaseCommand {
  static summary = "Revoke and delete the current Management session";

  /** Executes the logout command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(AuthLogout);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      async (local) => {
        await local.client.logout();
        await local.deleteSessionToken();
        return { authenticated: false };
      },
      true,
    );
  }
}
