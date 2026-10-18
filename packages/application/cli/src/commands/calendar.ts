// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Default Subject/world calendar using ordinary user parameters.
 * @module commands/calendar
 */
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
/** Reads calendar without generation, rule advancement or manually supplied identifiers. */
export default class Calendar extends BaseCommand {
  static summary = "查看默认主体的今天、本周或指定范围日历（零模型）";
  static args = {
    period: Args.string({ options: ["today", "week", "range"], default: "today" }),
  };
  static flags = { from: Flags.string(), to: Flags.string() };
  /** Reads the default world calendar through the generated client. */
  async run() {
    const { args, flags } = await this.parse(Calendar);
    return this.execute(
      flags["anchor-root"],
      async (local) => {
        const value = await local.client.getCalendar({
          period: args.period as "today" | "week" | "range",
          from: flags.from,
          to: flags.to,
        });
        if (this.jsonEnabled()) return value;
        if (!value.calendar) {
          this.log(
            value.state === "world_unconfigured"
              ? "当前主体尚未配置世界日历。"
              : value.state,
          );
          return;
        }
        this.log(
          `${value.calendar.displayTimezone} · ${value.calendar.interval.start} — ${value.calendar.interval.end}`,
        );
        for (const item of value.calendar.items)
          this.log(
            `${item.localStart} — ${item.localEnd} ${item.planned?.title ?? item.status} [${item.status}]`,
          );
        if (!value.calendar.items.length)
          this.log("该范围没有已记录的安排或生活事件。");
        if (value.calendar.continuation)
          this.log("尚有下一页，使用 world calendar 的 continuation 读取。");
      },
      true,
    );
  }
}
