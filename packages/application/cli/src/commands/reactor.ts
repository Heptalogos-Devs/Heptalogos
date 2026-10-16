// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Normal authenticated commands for the actual Subject foreground and metadata choices. @module commands/reactor */
import { Args, Flags } from "@oclif/core";
import { BaseCommand, CliFailure, toCliFailure } from "../base-command.js";
import { openOperatorGateway } from "../gateway-access.js";
/** Reading status/history/attention never starts a model; wake projects one native opportunity. */
export default class Reactor extends BaseCommand {
  static summary = "查询主体当前前台、历史与注意选择，或请求一次原生机会";
  static args = {
    operation: Args.string({
      required: true,
      options: ["status", "history", "attention", "wake"],
    }),
  };
  static flags = {
    "subject-id": Flags.string({ required: true }),
    "reaction-id": Flags.string(),
    "after-reaction-id": Flags.string(),
    "explanation-ref": Flags.string(),
    "operation-ref": Flags.string({ description: "wake 的明确幂等操作引用" }),
    limit: Flags.integer({ min: 1, max: 128, default: 32 }),
  };
  async run() {
    const { args, flags } = await this.parse(Reactor);
    return this.execute(
      flags["anchor-root"],
      async (local, signal) => {
        const gateway = await openOperatorGateway(local, { signal }),
          subjectId = flags["subject-id"];
        try {
          switch (args.operation) {
            case "status":
              return await gateway.reactorStatus({
                subjectId,
                ...(flags["reaction-id"] ? { reactionId: flags["reaction-id"] } : {}),
              });
            case "history":
              return await gateway.reactorHistory({
                subjectId,
                limit: flags.limit,
                ...(flags["after-reaction-id"]
                  ? { afterReactionId: flags["after-reaction-id"] }
                  : {}),
              });
            case "attention":
              return await gateway.reactorAttentionExplain({
                subjectId,
                ...(flags["explanation-ref"]
                  ? { explanationRef: flags["explanation-ref"] }
                  : {}),
              });
            case "wake": {
              if (!flags["operation-ref"])
                throw new CliFailure(
                  "cli.required_flag",
                  "wake 需要 --operation-ref。",
                  2,
                );
              return await gateway.reactorWake({
                subjectId,
                operationRef: flags["operation-ref"],
              });
            }
          }
        } catch (error) {
          throw toCliFailure(error);
        }
      },
      true,
    );
  }
}
