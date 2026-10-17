// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Drains and stops only the installed Host service.
 * @module commands/stop
 */
import { ServiceCommand, componentFlag } from "../service-command.js";
import type { InstalledComponent } from "../services.js";
/** Drains and stops only the installed Host service. */
export default class Stop extends ServiceCommand {
  static summary = "Drain and stop the installed Management Host user service";
  static flags = { component: componentFlag };
  /** Executes the bounded installed-service command. */
  async run() {
    const { flags } = await this.parse(Stop);
    return this.operate(
      flags["anchor-root"],
      "stop",
      flags.component as InstalledComponent | "all",
    );
  }
}
