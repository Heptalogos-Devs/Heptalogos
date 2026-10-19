// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Exports canonical readable Subject documents without model work or file watching.
 * @module commands/subject/documents
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Flags } from "@oclif/core";
import { BaseCommand, CliFailure } from "../../base-command.js";
/** Files remain derived views; editing does not mutate cognition. */
export default class SubjectDocuments extends BaseCommand {
  static summary = "导出当前 IDENTITY/SOUL/关系/语言/LIFE 文档（零模型）";
  static flags = {
    import: Flags.string({
      description: "明确导入文件中编辑过的 nous-revision 修订块；不调用模型",
    }),
    reason: Flags.string({
      dependsOn: ["import"],
      description: "认知修订原因，保存在正式历史中",
    }),
  };
  /** Exports the current canonical documents to the installation data directory. */
  async run() {
    const { flags } = await this.parse(SubjectDocuments);
    return this.execute(
      flags["anchor-root"],
      async (local) => {
        if (flags.import) {
          if (!flags.reason?.trim())
            throw new CliFailure(
              "management.document_reason_required",
              "导入修订需要 --reason 说明。",
              2,
            );
          const result = await local.client.importSubjectDocument({
            document: await readFile(flags.import, "utf8"),
            reason: flags.reason,
          });
          if (this.jsonEnabled()) {
            if (result.results.some((item) => item.status === "failed"))
              process.exitCode = 4;
            return result;
          }
          for (const item of result.results)
            this.log(
              `${item.status === "revised" ? "已修订" : item.status === "unchanged" ? "无变化" : "失败"}：${item.targetRevision}${item.problem ? " · " + item.problem : ""}`,
            );
          if (result.results.some((item) => item.status === "failed"))
            throw new CliFailure(
              "management.document_partial_failure",
              "部分修订失败；已完成结果保留，可按同一文件和原因继续。",
              4,
            );
          return;
        }
        const view = await local.client.getSubjectDocuments();
        const locator = JSON.parse(
          await readFile(join(local.anchorRoot, "heptalogos.bootstrap.json"), "utf8"),
        ) as { roots: { DATA: string } };
        const directory = join(locator.roots.DATA, "subject-documents", view.subjectId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const files = [];
        const drafts = [];
        for (const name of [
          "IDENTITY.md",
          "SOUL.md",
          "RELATIONSHIPS.md",
          "LANGUAGE.md",
          "LIFE.md",
        ]) {
          const file = join(directory, name),
            temporary = file + ".tmp";
          const previous = await readFile(file, "utf8").catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            },
          );
          if (previous !== null) {
            const match = /^<!-- heptalogos-export:([0-9a-f]{64}) -->\n/.exec(previous);
            const digest = createHash("sha256")
              .update(match ? previous.slice(match[0].length) : previous)
              .digest("hex");
            if (digest !== match?.[1]) {
              const draft = join(
                directory,
                "drafts",
                `${name}.${digest.slice(0, 16)}.md`,
              );
              await mkdir(join(directory, "drafts"), { recursive: true, mode: 0o700 });
              await writeFile(draft, previous, { mode: 0o600, flag: "wx" }).catch(
                (error: NodeJS.ErrnoException) => {
                  if (error.code !== "EEXIST") throw error;
                },
              );
              drafts.push(draft);
            }
          }
          const body = view.documents[name] ?? "未形成。";
          const digest = createHash("sha256").update(body).digest("hex");
          await writeFile(temporary, `<!-- heptalogos-export:${digest} -->\n${body}`, {
            mode: 0o600,
          });
          await rename(temporary, file);
          files.push(file);
        }
        if (!this.jsonEnabled()) {
          this.log(files.join("\n"));
          if (drafts.length)
            this.log(`原文件存在修改或来自旧导出，已保存在：\n${drafts.join("\n")}`);
          this.log(
            "编辑文件的 nous-revision.content 后，使用 subject documents --import 文件 --reason 说明显式修订；LIFE 的未来安排使用 calendar/world。再次导出会覆盖这些派生视图。",
          );
          return;
        }
        return {
          subjectId: view.subjectId,
          generatedAt: view.generatedAt,
          directory,
          files,
          drafts,
        };
      },
      true,
    );
  }
}
