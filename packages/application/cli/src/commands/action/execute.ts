// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the protected exact SystemAction execution command.
 * @module commands/action/execute
 */

import { Flags } from "@oclif/core";
import { BaseCommand, type CommonFlags } from "../../base-command.js";
import { readProtectedJsonFromStdin } from "../../password.js";
import type { SystemActionExecuteInput } from "@heptalogos/management-client";

/** Reauthenticates and executes one plan plus identical protected JSON input. */
export default class ActionExecute extends BaseCommand {
  static summary = "Execute one exact SystemAction from protected JSON stdin";
  static flags = {
    "input-stdin": Flags.boolean({
      description: "Read the plan and action body from protected stdin",
      required: true,
    }),
  };

  /** Executes the exact-plan command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(ActionExecute);
    const common = flags as typeof flags & CommonFlags & { "input-stdin": boolean };
    const input = await readProtectedJsonFromStdin();
    return this.execute(
      common["anchor-root"],
      (local) => local.client.executeSystemAction(input as SystemActionExecuteInput),
      true,
    );
  }
}
