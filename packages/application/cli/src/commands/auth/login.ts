// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the Administrator login command.
 * @module commands/auth/login
 */

import { Flags } from "@oclif/core";
import { BaseCommand, type CommonFlags } from "../../base-command.js";
import { readProtectedPassword } from "../../password.js";

/** Creates and stores an opaque Administrator session. */
export default class AuthLogin extends BaseCommand {
  static summary = "Create and store a Management session";
  static flags = {
    "password-stdin": Flags.boolean({
      description: "Read exactly one password line from stdin",
    }),
  };

  /** Executes the login command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(AuthLogin);
    const common = flags as typeof flags & CommonFlags & { "password-stdin": boolean };
    return this.execute(common["anchor-root"], async (local) => {
      const password = await readProtectedPassword(
        common["password-stdin"],
        "Administrator password",
      );
      const result = await local.client.login({ password });
      await local.saveSessionToken(result.sessionToken);
      return {
        authenticated: true,
        expiresAt: result.expiresAt,
      };
    });
  }
}
