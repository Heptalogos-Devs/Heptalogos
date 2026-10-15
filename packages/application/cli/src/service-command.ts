// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Commands available even while the Management Host is stopped.
 * @module service-command
 */
import { BaseCommand } from "./base-command.js";
import {
  operateInstalledService,
  type InstalledComponent,
  type ServiceOperation,
} from "./services.js";

/** Shares fixed-service operations and CLI output without contacting Management. */
export abstract class ServiceCommand extends BaseCommand {
  protected async operate(
    anchorRoot: string,
    operation: ServiceOperation,
    component: InstalledComponent = "host",
  ) {
    return this.present(
      await operateInstalledService(anchorRoot, component, operation),
    );
  }
}
