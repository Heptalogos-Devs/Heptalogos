// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic operator commands for Activity, attention, progress and exact native dispatch.
 * @module commands/life
 */
import { Args } from "@oclif/core";
import { OwnerCommand } from "../owner-command.js";
import { lifeOperations } from "../owner-operations.js";
/** Projects the existing service schemas through administrator-authenticated local access. */
export default class Life extends OwnerCommand {
  static summary = "管理活动、注意与实际进度（JSON 标准输入）";
  static description =
    "读取/变更同安装的 Life 活动。list 使用 subjectId、states、limit；get 使用 subjectId、activityId。变更须显式提供 owner schema 要求的 operationId、ID、expectedRevision 与实际权限。dispatch 只提交已采纳活动及真实 messageRefs，不接收模型 prompt 或自行授予工具。";
  static args = {
    operation: Args.string({
      required: true,
      options: Object.keys(lifeOperations),
      description:
        "确定性操作：list、get、propose、adopt、transition、progress、attention、dispatch。",
    }),
  };
  /** Invokes exactly one schema-generated operation and preserves its actual result. */
  async run() {
    const { flags, args } = await this.parse(Life);
    return this.operateOwner(flags["anchor-root"], "life", args.operation);
  }
}
