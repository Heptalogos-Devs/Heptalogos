// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Queries adopted claims and actual statement receipts without writing product truth. @module commands/narrative */
import { Args, Flags } from "@oclif/core";
import { BaseCommand, CliFailure, toCliFailure } from "../base-command.js";
import { openOperatorGateway } from "../gateway-access.js";
/** All arguments describe a bounded owner read; no review/Claim input is accepted. */
export default class Narrative extends BaseCommand {
  static summary = "按听众查询陈述，或解释实际平台消息";
  static args = {
    operation: Args.string({ required: true, options: ["claims", "explain"] }),
  };
  static flags = {
    "subject-id": Flags.string({ required: true }),
    "conversation-ref": Flags.string({ description: "claims 的canonical听众会话引用" }),
    "message-id": Flags.string({
      description: "explain 的实际平台 message ID，保留原字符串",
    }),
    domain: Flags.string(),
    from: Flags.string(),
    to: Flags.string(),
    status: Flags.string({
      options: ["adopted", "expressed", "uncertain", "not_sent"],
    }),
    "after-claim-id": Flags.string(),
    limit: Flags.integer({ min: 1, max: 128, default: 50 }),
  };
  async run() {
    const { flags, args } = await this.parse(Narrative);
    return this.execute(
      flags["anchor-root"],
      async (local, signal) => {
        const gateway = await openOperatorGateway(local, { signal });
        try {
          if (args.operation === "explain") {
            if (!flags["message-id"])
              throw new CliFailure(
                "cli.required_flag",
                "explain 需要 --message-id。",
                2,
              );
            return await gateway.explainStatement({
              subjectId: flags["subject-id"],
              platformMessageId: flags["message-id"],
            });
          }
          if (!flags["conversation-ref"])
            throw new CliFailure(
              "cli.required_flag",
              "claims 需要 --conversation-ref。",
              2,
            );
          const anyRange = flags.domain || flags.from || flags.to;
          if (anyRange && (!flags.domain || !flags.from || !flags.to))
            throw new CliFailure(
              "cli.required_flag",
              "限定所指时段时需同时提供 --domain、--from、--to。",
              2,
            );
          return await gateway.claimsTo({
            subjectId: flags["subject-id"],
            conversationRef: flags["conversation-ref"],
            limit: flags.limit,
            ...(anyRange
              ? {
                  about: {
                    timeDomainRef: flags.domain!,
                    start: flags.from!,
                    end: flags.to!,
                  },
                }
              : {}),
            ...(flags.status
              ? {
                  status: flags.status as
                    "adopted" | "expressed" | "uncertain" | "not_sent",
                }
              : {}),
            ...(flags["after-claim-id"]
              ? { afterClaimId: flags["after-claim-id"] }
              : {}),
          });
        } catch (error) {
          throw toCliFailure(error);
        }
      },
      true,
    );
  }
}
