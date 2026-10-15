// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Controls the independent maintenance Gateway service slot.
 * @module commands/maintenance
 */
import { Args } from "@oclif/core";
import { ServiceCommand } from "../service-command.js";
import type { ServiceOperation } from "../services.js";
/** Controls the independent maintenance Gateway service slot. */
export default class Maintenance extends ServiceCommand {
  static summary =
    "Control the independent maintenance Gateway, including while the Host is stopped";
  static args = {
    operation: Args.string({
      options: ["status", "start", "stop", "restart"],
      default: "status",
    }),
  };
  /** Executes the bounded installed-service command. */
  async run() {
    const { flags, args } = await this.parse(Maintenance);
    return this.operate(
      flags["anchor-root"],
      args.operation as ServiceOperation,
      "maintenance",
    );
  }
}
