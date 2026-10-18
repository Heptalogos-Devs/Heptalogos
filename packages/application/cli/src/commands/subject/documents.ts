// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Exports canonical readable Subject documents without model work or file watching.
 * @module commands/subject/documents
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { BaseCommand } from "../../base-command.js";
/** Files remain derived views; editing does not mutate cognition. */
export default class SubjectDocuments extends BaseCommand {
  static summary = "导出当前 IDENTITY/SOUL/关系/语言/LIFE 文档（零模型）";
  /** Exports the current canonical documents to the installation data directory. */
  async run() {
    const { flags } = await this.parse(SubjectDocuments);
    return this.execute(
      flags["anchor-root"],
      async (local) => {
        const view = await local.client.getSubjectDocuments();
        const locator = JSON.parse(
          await readFile(join(local.anchorRoot, "heptalogos.bootstrap.json"), "utf8"),
        ) as { roots: { DATA: string } };
        const directory = join(locator.roots.DATA, "subject-documents", view.subjectId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const files = [];
        for (const name of [
          "IDENTITY.md",
          "SOUL.md",
          "RELATIONSHIPS.md",
          "LANGUAGE.md",
          "LIFE.md",
        ]) {
          const file = join(directory, name),
            temporary = file + ".tmp";
          await writeFile(temporary, view.documents[name] ?? "未形成。", {
            mode: 0o600,
          });
          await rename(temporary, file);
          files.push(file);
        }
        if (!this.jsonEnabled()) {
          this.log(files.join("\n"));
          return;
        }
        return {
          subjectId: view.subjectId,
          generatedAt: view.generatedAt,
          directory,
          files,
        };
      },
      true,
    );
  }
}
