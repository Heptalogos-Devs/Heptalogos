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
    period: Args.string({
      options: ["today", "week", "range", "template"],
      default: "today",
    }),
  };
  static flags = { from: Flags.string(), to: Flags.string() };
  /** Reads the default world calendar through the generated client. */
  async run() {
    const { args, flags } = await this.parse(Calendar);
    return this.execute(
      flags["anchor-root"],
      async (local) => {
        if (args.period === "template") {
          const template = await local.client.getSchoolTimeTemplate();
          if (this.jsonEnabled()) return template;
          this.log(
            `可选学校时间骨架 · ${template.timezone}\n公布：${template.publishedOn} · 生效：${template.effectiveFrom}\n来源：${template.source}`,
          );
          template.lessons.forEach((time, index) =>
            this.log(`第${index + 1}节：${time.join(" — ")}`),
          );
          for (const point of template.otherTimes)
            this.log(
              `${point.title}：${point.start}${point.end ? " — " + point.end : ""}`,
            );
          this.log(
            "在 WorldProfile.schoolCalendar 中明确选择日期、星期和课次后采用；当前主体资料未改变。",
          );
          return;
        }
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
        if (value.world) this.log(`世界当前时刻：${value.world.at}`);
        for (const item of value.calendar.items)
          this.log(
            `${item.localStart} — ${item.localEnd} ${item.planned?.title ?? item.status} [${item.status === "planned" && !item.lived.length && value.world && Date.parse(item.interval.end) <= Date.parse(value.world.at) ? "已过去，未实现" : item.status}]`,
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
