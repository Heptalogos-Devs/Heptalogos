// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Reads and resumes the existing task through its owner; retained work is not recreated.
 * @module commands/task
 */
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../base-command.js";
/** Ordinary parameters default to the current Subject. */
export default class Task extends BaseCommand {
  static summary = "查看原任务、保留成果和阻塞；--resume恢复同一任务";
  static args = { id: Args.string({ required: true }) };
  static flags = {
    resume: Flags.boolean({ description: "恢复同一任务；自动工作暂停时不会启动模型" }),
    runs: Flags.boolean({ description: "列出实际角色运行登记" }),
    inputs: Flags.boolean({
      description: "明确查看一项运行的原始模型请求及宿主输入；可能包含聊天正文",
    }),
    "run-id": Flags.string({
      description: "从 --runs 选择原运行，默认取最近已接纳运行",
    }),
    before: Flags.string({ description: "读取更早登记，使用上一页nextRunId" }),
  };
  /** Reads the original task and applies an explicitly requested owner resume. */
  async run() {
    const { args, flags } = await this.parse(Task);
    return this.execute(
      flags["anchor-root"],
      async (local) => {
        const recovery = flags.resume
          ? await local.client.resumeTask(args.id)
          : undefined;
        const view = await local.client.getTaskDetails(args.id, {
          ...(flags.inputs ? { inputs: "true" as const } : {}),
          ...(flags["run-id"] ? { runId: flags["run-id"] } : {}),
          ...(flags.before ? { before: flags.before } : {}),
        });
        const { activity, retained, automaticWorkEnabled } = view;
        const result = {
          activity,
          retained,
          automaticWorkEnabled,
          ...(recovery
            ? {
                recoveredCandidates: recovery.recoveredCandidates,
                recoveredRunIds: recovery.recoveredRunIds,
                blocked: recovery.blocked,
              }
            : {}),
          ...(flags.runs || flags.inputs || flags["run-id"] || flags.before
            ? { details: view }
            : {}),
        };
        if (this.jsonEnabled()) return result;
        this.log(
          `目标：${activity.purpose}\n状态：${activity.state}\n任务：${activity.activityId}\n原始来源：${activity.sourceRefs.join("、")}\n保留成果：${retained.reduce((n, run) => n + run.resultCount, 0)}条worker结果；${activity.progress.resultRefs.length}个进展引用\n进展：${activity.progress.note.split("\nReactor ")[0] || "尚未记录有效进展"}\n下一条件：${activity.continuationRequired ? "需要明确resume" : (activity.nextOpportunity?.at ?? "尚未安排")}\n自动付费工作：${result.automaticWorkEnabled ? "配置允许" : "暂停"}`,
        );
        for (const problem of recovery?.blocked ?? [])
          this.log(
            `保留结果仍待处理：${problem.detail} (${problem.code}) · ${problem.runId}`,
          );
        if (result.details) {
          for (const run of result.details.runs) {
            this.log(
              `${run.recordedAt} · ${run.role}/${run.purpose} · ${run.dispatchState} · ${run.runId}`,
            );
            if (run.outputProblem)
              this.log(
                `  输出待处理：${run.outputProblem.detail} (${run.outputProblem.code})`,
              );
          }
          if (flags.inputs || flags["run-id"])
            this.log(JSON.stringify(result.details, null, 2));
          if (result.details.nextRunId)
            this.log(`更早登记：--before ${result.details.nextRunId}`);
        }
      },
      true,
    );
  }
}
