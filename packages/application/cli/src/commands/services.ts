// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Reads each installed service slot without depending on the Host.
 * @module commands/services
 */
import { ServiceCommand } from "../service-command.js";
import { operateInstalledService } from "../services.js";
/** Reads each installed service slot without depending on the Host. */
export default class Services extends ServiceCommand {
  static summary =
    "Read installed Host, subject and maintenance service states without contacting the Host";
  /** Executes the bounded installed-service command. */
  async run() {
    const { flags } = await this.parse(Services);
    return this.present(
      await Promise.all(
        (["host", "subject", "maintenance"] as const).map((component) =>
          operateInstalledService(flags["anchor-root"], component, "status"),
        ),
      ),
    );
  }
}
