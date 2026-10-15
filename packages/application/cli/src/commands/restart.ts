// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Restarts the installed Host through the user service manager.
 * @module commands/restart
 */
import { ServiceCommand } from "../service-command.js";
/** Restarts the installed Host through the user service manager. */
export default class Restart extends ServiceCommand {
  static summary = "Restart the installed Management Host user service";
  /** Executes the bounded installed-service command. */
  async run() {
    const { flags } = await this.parse(Restart);
    return this.operate(flags["anchor-root"], "restart");
  }
}
