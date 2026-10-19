// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Default Subject/world calendar using ordinary user parameters.
 * @module commands/calendar
 */
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
/** Reads calendar without generation, rule advancement or manually supplied identifiers. */
export default class Calendar extends BaseCommand {
  static summary = "查看默认主体日历或某时刻详情（零模型）";
  static args = {
    period: Args.string({
      options: ["today", "week", "range", "template", "at"],
      default: "today",
    }),
    moment: Args.string({ description: "日历时刻，如 2026-10-19T10:00" }),
  };
  static flags = { from: Flags.string(), to: Flags.string() };
  /** Reads the default world calendar through the generated client. */
  async run() {
    const { args, flags } = await this.parse(Calendar);
    return this.execute(
      flags["anchor-root"],
      async (local) => {
        if (args.period === "at") {
          if (!args.moment) this.error("请提供时刻：calendar at '2026-10-19T10:00'");
          const value = await local.client.getCalendarMoment({
            at: args.moment,
            to: flags.to,
          });
          if (this.jsonEnabled()) return value;
          this.log(
            `${value.timezone} · ${value.at}${value.to ? " — " + value.to : ""}`,
          );
          for (const item of value.calendar.items) {
            this.log(
              `计划/实际 · ${item.localStart} — ${item.localEnd} · ${item.planned?.title ?? item.status} [${item.status}]`,
            );
            if (item.planned) this.log(item.planned.description);
            for (const event of item.lived) {
              if ("title" in event) this.log(`实际 · ${event.title}\n${event.content}`);
              else this.log(`感知 · ${event.content}`);
              this.log(`记录于 ${event.recordedAt} · ${event.eventId}`);
            }
          }
          if (!value.calendar.items.length)
            this.log("该时段没有已记录的计划或生活事件。");
          for (const deviation of value.deviations)
            this.log(
              `偏离 · ${deviation.detail} [${deviation.state}] · ${deviation.instanceId}`,
            );
          this.log(`截至 ${value.perceptionCutoff} 主体当时可感知事件：`);
          for (const event of value.perceptibleEvents)
            this.log(`${event.at.at} · ${event.content} · ${event.eventId}`);
          if (!value.perceptibleEvents.length) this.log("没有该时段的可感知事件记录。");
          this.log(
            `关联上下文自 ${value.contextStart} 截至 ${value.perceptionCutoff} · ${value.contextSelection}`,
          );
          for (const input of value.inputs) {
            this.log(
              `原输入 · ${input.role} · ${input.contextAt?.at ?? "世界时刻未知"} · ${input.consumed ? "已完成" : "已准入"} · ${input.runId}`,
            );
            for (const contact of input.contacts)
              this.log(
                `实际接触 · ${contact.observedAt?.at ?? "时刻未知"} · ${contact.text ?? "非文本材料"}\n${contact.contactRef} · 真实记录于 ${input.recordedAt}`,
              );
          }
          for (const decision of value.decisions)
            this.log(
              `关联决定 · ${decision.record.decision.action} · ${decision.record.decision.reason ?? "未记录理由"}\n采用于真实时间 ${decision.record.adoptedAt} · 输入世界时刻 ${decision.inputContextAt?.at ?? "未知"} · ${decision.record.decisionRef}`,
            );
          for (const statement of value.statements) {
            this.log(
              `关联原文 · ${statement.briefId} · ${statement.adopted ? "已采用" : "候选"}${statement.discarded ? "，已放弃" : ""} · 真实记录于 ${statement.recordedAt}`,
            );
            this.log(
              `对象 · ${statement.audience.channel} / ${statement.audience.to} · ${statement.audience.conversationRef}`,
            );
            for (const payload of statement.payloads) this.log(payload.text);
            this.log(
              `交付：${statement.delivery.map((part) => part.state + (part.messageId ? " · " + part.messageId : "")).join("；") || "无交付记录"}`,
            );
          }
          for (const reaction of value.foreground)
            this.log(
              `关联关注 · ${reaction.state} · 真实开始于 ${reaction.startedAt} · ${reaction.reactionId}`,
            );
          for (const unknown of value.unknown) this.log(`未知/时标说明 · ${unknown}`);
          if (Object.values(value.limited).some(Boolean))
            this.log("部分读取达到现有分页上限，当前详情不完整。");
          return;
        }
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
