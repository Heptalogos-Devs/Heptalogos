// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Explicit persistent Subject management through the owning API.
 * @module commands/subject
 */
import { BaseCommand, type CommonFlags } from "../../base-command.js";
/** Reads the configured binding and actual Nous Subject availability. */
export default class SubjectShow extends BaseCommand {
  static summary = "Read the current Subject binding";
  /** Reads the current binding and live cognition observation. */
  async run() {
    const { flags } = await this.parse(SubjectShow);
    return this.execute(
      (flags as typeof flags & CommonFlags)["anchor-root"],
      (local) => local.client.getSubject(),
      true,
    );
  }
}
