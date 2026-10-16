// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Starts the installed Host and waits for its Management endpoint.
 * @module commands/start
 */
import { ServiceCommand, componentFlag } from "../service-command.js";
import type { InstalledComponent } from "../services.js";
/** Starts the installed Host and waits for its Management endpoint. */
export default class Start extends ServiceCommand {
  static summary = "Start the installed Management Host user service";
  static flags = { component: componentFlag };
  /** Executes the bounded installed-service command. */
  async run() {
    const { flags } = await this.parse(Start);
    return this.operate(
      flags["anchor-root"],
      "start",
      flags.component as InstalledComponent | "all",
    );
  }
}
