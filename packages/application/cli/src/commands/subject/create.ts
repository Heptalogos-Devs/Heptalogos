// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Explicit persistent Subject management through the owning API.
 * @module commands/subject
 */
import { Flags } from "@oclif/core";
import { readFile } from "node:fs/promises";
import { BaseCommand, type CommonFlags } from "../../base-command.js";
/** Creates an independent Subject; binding and Seed interpretation remain explicit. */
export default class SubjectCreate extends BaseCommand {
  static summary =
    "Create a Subject through Nous without replacing the current binding";
  static flags = {
    "operation-id": Flags.string({ required: true }),
    memory: Flags.boolean(),
    self: Flags.boolean(),
    "seed-file": Flags.string(),
    "seed-format": Flags.string({ options: ["markdown", "toml"], default: "markdown" }),
  };
  /** Creates an independent Subject without replacing the current binding. */
  async run() {
    const { flags } = await this.parse(SubjectCreate);
    const text = flags["seed-file"]
      ? await readFile(flags["seed-file"], "utf8")
      : undefined;
    return this.execute(
      (flags as typeof flags & CommonFlags)["anchor-root"],
      (local) =>
        local.client.createSubject({
          operationId: flags["operation-id"],
          capabilities: { memory: flags.memory, selfCognition: flags.self },
          ...(text
            ? { seed: { text, format: flags["seed-format"] as "markdown" | "toml" } }
            : {}),
        }),
      true,
    );
  }
}
