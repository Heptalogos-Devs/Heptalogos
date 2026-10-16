// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runs foreground operator owner commands through the existing local authentication and exit contract.
 * @module owner-command
 */
import { Flags } from "@oclif/core";
import { BaseCommand, CliFailure, toCliFailure } from "./base-command.js";
import { openOperatorGateway } from "./gateway-access.js";
import { invokeOwnerOperation } from "./owner-operations.js";
import { readProtectedJsonFromStdin } from "./password.js";
/** Requires explicit JSON stdin; it never guesses IDs, revisions, authority, or model instructions. */
export abstract class OwnerCommand extends BaseCommand {
  static flags = {
    stdin: Flags.boolean({
      required: true,
      description: "从标准输入读取一份完整 JSON 请求；不在命令行传正文或凭据。",
    }),
  };
  protected async operateOwner(
    anchorRoot: string,
    kind: "life" | "pursuit",
    operation: string,
  ) {
    return this.execute(
      anchorRoot,
      async (local, signal) => {
        let input: unknown;
        try {
          input = await readProtectedJsonFromStdin();
          if (typeof input !== "object" || !input || Array.isArray(input))
            throw Error("object required");
        } catch {
          throw new CliFailure(
            "cli.invalid_json",
            "标准输入必须是一份不超过 65536 字节的 JSON 对象。",
            2,
          );
        }

        const gateway = await openOperatorGateway(local, { signal });
        // Gateway 401 must not evict an already verified administrator session from the OS keyring.
        try {
          return await invokeOwnerOperation(gateway, kind, operation, input);
        } catch (error) {
          throw toCliFailure(error);
        }
      },
      true,
    );
  }
}
