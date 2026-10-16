// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic operator commands for exact Pursuit adoption, evaluation and immutable history.
 * @module commands/pursuit
 */
import { Args } from "@oclif/core";
import { OwnerCommand } from "../owner-command.js";
import { pursuitOperations } from "../owner-operations.js";
/** Projects Pursuit service operations without duplicating motivation or evaluation semantics. */
export default class Pursuit extends OwnerCommand {
  static summary = "管理主动追求、条件评价与历史（JSON 标准输入）";
  static description =
    "list 使用 subjectId、states、limit；get/recheck 使用 subjectId、pursuitId；history 另需 limit，可带 afterRevision。adopt/evaluate/transition/reconsider 的 ID、精确条件修订和 CAS 全部显式输入。评价只提交实际 evidenceRefs，不能以 CLI 输入真值或 complete 宣布满足。";
  static args = {
    operation: Args.string({
      required: true,
      options: Object.keys(pursuitOperations),
      description:
        "确定性操作：list、get、adopt、evaluate、recheck、transition、reconsider、history。",
    }),
  };
  /** Invokes exactly one schema-generated operation and preserves its actual result. */
  async run() {
    const { flags, args } = await this.parse(Pursuit);
    return this.operateOwner(flags["anchor-root"], "pursuit", args.operation);
  }
}
