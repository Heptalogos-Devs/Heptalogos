// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Commands available even while the Management Host is stopped.
 * @module service-command
 */
import { Flags } from "@oclif/core";
import { BaseCommand } from "./base-command.js";
import {
  operateInstalledService,
  type InstalledComponent,
  type ServiceOperation,
  readInstalledServices,
} from "./services.js";
/** Explicit selection preserves the independent installed components. */
export const componentFlag = Flags.string({
  options: ["host", "subject", "maintenance", "all"],
  default: "host",
  description: "要控制的安装组件；all 按依赖顺序处理已配置服务",
});

/** Shares fixed-service operations and CLI output without contacting Management. */
export abstract class ServiceCommand extends BaseCommand {
  protected async operate(
    anchorRoot: string,
    operation: ServiceOperation,
    component: InstalledComponent | "all" = "host",
  ) {
    if (component === "all") {
      const descriptor = await readInstalledServices(anchorRoot);
      const order: InstalledComponent[] =
        operation === "stop"
          ? ["subject", "maintenance", "host"]
          : ["host", "subject", "maintenance"];
      const services = [];
      for (const name of order)
        services.push(
          await operateInstalledService(
            anchorRoot,
            name,
            descriptor.services[name].configured ? operation : "status",
          ),
        );
      return this.present({ services });
    }
    const result = await operateInstalledService(anchorRoot, component, operation);
    return this.present(result);
  }
}
