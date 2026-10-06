// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the first-administrator claim command.
 * @module commands/admin/claim
 */

import { Flags } from "@oclif/core";
import { BaseCommand, type CommonFlags } from "../../base-command.js";
import { readProtectedPassword } from "../../password.js";

/** Claims the first Administrator through the live Management API. */
export default class AdminClaim extends BaseCommand {
  static summary = "Claim the first Administrator";
  static flags = {
    "password-stdin": Flags.boolean({
      description: "Read exactly one password line from stdin",
    }),
  };

  /** Executes the claim command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(AdminClaim);
    const common = flags as typeof flags & CommonFlags & { "password-stdin": boolean };
    return this.execute(common["anchor-root"], async (local) => {
      const claim = await local.readFirstClaim();
      if (claim === undefined) {
        throw new Error("No usable first-administrator claim is published");
      }
      const password = await readProtectedPassword(
        common["password-stdin"],
        "Administrator password",
      );
      const result = await local.client.claimFirstAdministrator({
        claimId: claim.claimId,
        claimSecret: claim.claimSecret,
        password,
      });
      return { administratorId: result.administratorId };
    });
  }
}
