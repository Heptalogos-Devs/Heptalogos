// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Human terminal projection of the generated Management read model.
 * @module operator
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { openLocalManagementClient } from "@heptalogos/management-client/node";
import { readInstalledServices } from "./services.js";

/** Reads OS autostart truth and current Management facts without starting either service. */
export async function readOperatorOverview(anchorRoot: string, signal?: AbortSignal) {
  const descriptor = await readInstalledServices(anchorRoot);
  const manifest = JSON.parse(
    await readFile(join(anchorRoot, "manifest.json"), "utf8"),
  ) as { productGeneration: string };
  const services = await Promise.all(
    Object.entries(descriptor.services).map(async ([component, service]) => {
      if (!service.configured)
        return { component, state: "unconfigured", autostart: false };
      const response = await execa(
        "systemctl",
        ["--user", "show", service.unit, "--property=ActiveState,UnitFileState"],
        { reject: false, timeout: 3000 },
      );
      const properties = Object.fromEntries(
        response.stdout.split("\n").map((line) => line.split("=", 2)),
      );
      return {
        component,
        state: properties.ActiveState ?? "inactive",
        autostart: ["enabled", "enabled-runtime"].includes(properties.UnitFileState),
      };
    }),
  );
  try {
    const discovery = await openLocalManagementClient({ anchorRoot, signal });
    const sessionToken = await discovery.readSessionToken();
    if (!sessionToken)
      return {
        anchorRoot,
        productGeneration: manifest.productGeneration,
        services,
        overview: null,
        issue: "请先执行 auth login 登录管理；不会启动主体",
      };
    const local = await openLocalManagementClient({ anchorRoot, sessionToken, signal });
    return {
      anchorRoot,
      productGeneration: manifest.productGeneration,
      services,
      overview: await local.client.getOverview(),
      issue: null,
    };
  } catch (error) {
    return {
      anchorRoot,
      productGeneration: manifest.productGeneration,
      services,
      overview: null,
      issue: error instanceof Error ? error.message : "管理 Host 已停止",
    };
  }
}
/** Presents useful work and blockers rather than raw Reactor identities. */
export function renderOperatorOverview(
  value: Awaited<ReturnType<typeof readOperatorOverview>>,
) {
  const current = value.overview;
  const lines = [
    "Heptalogos · 运行总览",
    `安装：${value.anchorRoot}`,
    `程序：${current?.programPath ?? (value.services.some((service) => service.component === "host" && service.state === "active") ? "进程已启动，管理尚未就绪" : "Host已停止")}`,
    `选中代次：${value.productGeneration}`,
    ...value.services.map(
      (s) =>
        `${s.component.padEnd(12)} ${s.state.padEnd(12)} 自启：${s.autostart ? "开" : "关"}`,
    ),
  ];
  if (!current) return [...lines, `阻塞：${value.issue}`].join("\n");
  lines.push(
    `主体：${current.subjectName} (${current.status.subject.id ?? "未绑定"})`,
    `自动付费工作：${current.status.subject.enabled ? "配置允许" : "已暂停"}`,
    `模型：${current.model}`,
    `QQ：${current.qqAccount ?? "未配置"}；${current.qqState}`,
    `前台：${current.foreground?.candidate.metadata.label ?? "无"}`,
  );
  const maintenance = current.cognitionMaintenance;
  if (current.living)
    lines.push(
      `生活：${current.living.currentPlaceRef} · 精力${current.living.energy}/100 · 实际记录至${current.living.integratedThrough.at}`,
    );
  const state = (enabled: boolean | null | undefined) =>
    enabled === undefined || enabled === null ? "未知" : enabled ? "开" : "关";
  lines.push(
    `Nous自动维护：系统${state(maintenance?.schedulerEnabled)} / 当前主体${state(maintenance?.subjectEnabled)}`,
  );
  for (const issue of current.issues) lines.push(`阻塞：${issue}`);
  lines.push("", "未完成任务：");
  const recentTasks = [...current.tasks].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  for (const task of recentTasks.slice(0, 4)) {
    const results = current.retainedResults
      .filter((r) => r.activityId === task.activityId)
      .reduce((n, r) => n + r.resultCount, 0);
    lines.push(
      `  [${task.state}] ${task.purpose.slice(0, 80)}`,
      `    已存${results}条worker结果/${task.progress.resultRefs.length}个引用；${task.continuationRequired ? "等待明确恢复" : (task.nextOpportunity?.at ?? "下一条件未安排")} · task ${task.activityId}`,
    );
    const progress = task.progress.note.split("\nReactor ")[0]?.trim();
    if (progress) lines.push(`    进展：${progress.slice(0, 240)}`);
  }
  if (!current.tasks.length) lines.push("  无");
  if (current.narrativeWork.length) {
    lines.push("", "陈述后续工作：");
    for (const work of current.narrativeWork)
      lines.push(
        `  ${work.state === "blocked" ? "待纠正" : work.runId ? "索引处理中" : "等待索引"}：${work.problem ?? "保留原文，后台处理语义"} · task ${work.activityId}`,
      );
  }
  if (current.tasks.length > 4 || current.moreTasks)
    lines.push("  其他任务见 status --json；task <id> 查看详情和原成果。");
  lines.push("", "角色用量：输入 / 输出 / cache读 / cache写（保留结果，费用未知）");
  const roles = new Map<
    string,
    {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      missing: number;
      registered: number;
    }
  >();
  for (const u of current.usage) {
    const total = roles.get(u.role) ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      missing: 0,
      registered: 0,
    };
    total.input += u.input;
    total.output += u.output;
    total.cacheRead += u.cacheRead;
    total.cacheWrite += u.cacheWrite;
    total.missing += u.missingUsage;
    total.registered += u.recordedRuns;
    roles.set(u.role, total);
  }
  for (const [role, u] of roles) {
    lines.push(
      u.registered === u.missing
        ? `  ${role}: 用量未知（${u.missing}项运行登记无用量回执）`
        : `  ${role}: 已知 ${u.input} / ${u.output} / ${u.cacheRead} / ${u.cacheWrite}；另有${u.missing}项登记无用量回执`,
    );
  }
  lines.push(
    "",
    "文档：subject documents · 日历：calendar today / week · task <id> · Ctrl-C仅退出观察",
  );
  return lines.join("\n");
}
