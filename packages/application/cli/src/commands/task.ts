// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Reads and resumes the existing task through its owner; retained work is not recreated.
 * @module commands/task
 */
import { Args, Flags } from "@oclif/core";
import { BaseCommand, CliFailure } from "../base-command.js";
import { openOperatorGateway } from "../gateway-access.js";
/** Ordinary parameters default to the current Subject. */
export default class Task extends BaseCommand {
  static summary = "查看原任务、保留成果和阻塞；--resume恢复同一任务";
  static args = { id: Args.string({ required: true }) };
  static flags = {
    resume: Flags.boolean({ description: "恢复同一任务；自动工作暂停时不会启动模型" }),
  };
  /** Reads the original task and applies an explicitly requested owner resume. */
  async run() {
    const { args, flags } = await this.parse(Task);
    return this.execute(
      flags["anchor-root"],
      async (local) => {
        const current = await local.client.getConfiguration();
        const subjectId = current.settings?.subject.id;
        if (!subjectId)
          throw new CliFailure("management.subject_unbound", "当前未绑定主体。", 6);
        const gateway = await openOperatorGateway(local);
        let { activity } = await gateway.readActivity({
          subjectId,
          activityId: args.id,
        });
        if (!activity)
          throw new CliFailure("life.not_found", "当前主体没有该任务。", 4);
        if (flags.resume)
          activity = await gateway.transitionActivity({
            subjectId,
            activityId: args.id,
            expectedRevision: activity.revision,
            action: "resume",
            reason: "操作者从任务详情明确恢复原任务",
          });
        const overview = await local.client.getOverview();
        const retained = overview.retainedResults.filter(
          (result) => result.activityId === args.id,
        );
        const result = {
          activity,
          retained,
          automaticWorkEnabled: current.settings?.subject.enabled ?? false,
        };
        if (this.jsonEnabled()) return result;
        this.log(
          `目标：${activity.purpose}\n状态：${activity.state}\n任务：${activity.activityId}\n原始来源：${activity.sourceRefs.join("、")}\n保留成果：${retained.reduce((n, run) => n + run.resultCount, 0)}条worker结果；${activity.progress.resultRefs.length}个进展引用\n进展：${activity.progress.note.split("\nReactor ")[0] || "尚未记录有效进展"}\n下一条件：${activity.continuationRequired ? "需要明确resume" : (activity.nextOpportunity?.at ?? "尚未安排")}\n自动付费工作：${result.automaticWorkEnabled ? "配置允许" : "暂停"}`,
        );
      },
      true,
    );
  }
}
