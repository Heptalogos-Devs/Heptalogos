// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the protected SystemAction planning command.
 * @module commands/action/plan
 */

import { Flags } from "@oclif/core";
import { BaseCommand, type CommonFlags } from "../../base-command.js";
import { readProtectedJsonFromStdin } from "../../password.js";
import type { SystemActionRequestInput } from "@heptalogos/management-client";

/** Creates a side-effect-free plan from one protected JSON action body. */
export default class ActionPlan extends BaseCommand {
  static summary = "Plan one current SystemAction from protected JSON stdin";
  static flags = {
    "input-stdin": Flags.boolean({
      description: "Read the complete action body from protected stdin",
      required: true,
    }),
  };

  /** Executes the planning command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(ActionPlan);
    const common = flags as typeof flags & CommonFlags & { "input-stdin": boolean };
    const input = await readProtectedJsonFromStdin();
    return this.execute(
      common["anchor-root"],
      (local) => local.client.planSystemAction(input as SystemActionRequestInput),
      true,
    );
  }
}
