// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Explicit persistent Subject management through the owning API.
 * @module commands/subject
 */
import { Args, Flags } from "@oclif/core";
import { BaseCommand, type CommonFlags } from "../../base-command.js";
/** Binds an existing Subject after the Host verifies Nous ownership. */
export default class SubjectBind extends BaseCommand {
  static summary = "Bind an existing Nous Subject";
  static args = { id: Args.string({ required: true }) };
  static flags = { "expected-revision": Flags.string({ required: true }) };
  /** Verifies and binds the explicit Subject through Management. */
  async run() {
    const { args, flags } = await this.parse(SubjectBind);
    return this.execute(
      (flags as typeof flags & CommonFlags)["anchor-root"],
      (local) =>
        local.client.bindSubject({
          subjectId: args.id,
          expectedRevision: flags["expected-revision"],
        }),
      true,
    );
  }
}
