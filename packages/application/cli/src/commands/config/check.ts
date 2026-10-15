// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Deterministic product configuration command.
 * @module commands/config
 */
import { Flags } from "@oclif/core";
import { BaseCommand, type CommonFlags } from "../../base-command.js";
import { readProtectedJsonFromStdin } from "../../password.js";
import type { ProductSettings } from "@heptalogos/management-client";
/** Checks a complete typed settings document through the generated client. */
export default class ConfigurationCheck extends BaseCommand {
  static summary = "Check product settings supplied as JSON on stdin";
  static flags = {
    stdin: Flags.boolean({ required: true }),
    "expected-revision": Flags.string(),
  };
  /** Validates the supplied settings without creating a revision. */
  async run() {
    const { flags } = await this.parse(ConfigurationCheck);
    const common = flags as typeof flags & CommonFlags;
    return this.execute(
      common["anchor-root"],
      async (local) => {
        const settings = (await readProtectedJsonFromStdin()) as ProductSettings;
        return local.client.checkConfiguration(settings);
      },
      true,
    );
  }
}
