// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the aggregate status command.
 * @module commands/status
 */

import { Flags } from "@oclif/core";
import { setTimeout as delay } from "node:timers/promises";
import { BaseCommand } from "../base-command.js";
import { readOperatorOverview, renderOperatorOverview } from "../operator.js";

/** Reads aggregate Product Host status. */
export default class Status extends BaseCommand {
  static summary = "Read aggregate Product Host status";
  static flags = {
    watch: Flags.boolean({ description: "持续只读观察；Ctrl-C只退出终端" }),
    interval: Flags.integer({
      min: 3,
      max: 60,
      default: 5,
      description: "观察间隔，现实秒",
    }),
  };

  /** Executes the status command. */
  async run(): Promise<unknown> {
    const { flags } = await this.parse(Status);
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (flags.watch) process.once("SIGINT", stop);
    try {
      do {
        const value = await readOperatorOverview(
          flags["anchor-root"],
          controller.signal,
        );
        if (controller.signal.aborted) break;
        if (!flags.watch && this.jsonEnabled()) return value;
        if (flags.watch && process.stdout.isTTY && !this.jsonEnabled())
          process.stdout.write("\u001b[2J\u001b[H");
        this.log(
          this.jsonEnabled() ? JSON.stringify(value) : renderOperatorOverview(value),
        );
        if (!flags.watch) break;
        await delay(flags.interval * 1000, undefined, {
          signal: controller.signal,
        }).catch(() => undefined);
      } while (!controller.signal.aborted);
    } finally {
      process.removeListener("SIGINT", stop);
    }
  }
}
