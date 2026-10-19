// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Operator views and explicit document revisions over the existing owners.
 * @module operator
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { v5 as uuidv5 } from "uuid";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  activitySchema,
  calendarResultSchema,
  subjectReactionSchema,
  worldLivingStateSchema,
  worldCalendarWindow,
  schoolCalendarTemplate,
} from "@heptalogos/subject";
import {
  productStatusSchema,
  type ProductManagement,
  managementProblem,
  managementProblemSchema,
} from "@heptalogos/management";
import type { createGatewayRuntime } from "./gateway-runtime.js";
import { connectProductNous } from "./nous.js";
import { createWorldClockManagement } from "./world-clock.js";
import type { NousClient } from "@nous-wave/client";
import {
  encodeSelfContent,
  decodeSelfContent,
  encodeSocialContent,
  decodeSocialContent,
} from "@nous-wave/client/host-bridge";
import { PRODUCT_GENERATION_ID } from "./generated/build-identities.js";

const object = { additionalProperties: false } as const;
const text = Type.String();
const usageSchema = Type.Object(
  {
    role: text,
    purpose: text,
    activityId: text,
    recordedRuns: Type.Number(),
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    missingUsage: Type.Number(),
    cost: Type.Null(),
  },
  object,
);
/** A current view, not a second durable product state. */
export const operatorOverviewSchema = Type.Object(
  {
    status: productStatusSchema,
    anchorRoot: text,
    programPath: text,
    productGeneration: text,
    subjectName: text,
    model: text,
    qqAccount: Type.Union([text, Type.Null()]),
    qqState: text,
    tasks: Type.Array(activitySchema),
    moreTasks: Type.Boolean(),
    retainedResults: Type.Array(
      Type.Object(
        { activityId: text, runId: text, resultCount: Type.Number() },
        object,
      ),
    ),
    foreground: Type.Union([subjectReactionSchema, Type.Null()]),
    living: Type.Union([worldLivingStateSchema, Type.Null()]),
    usage: Type.Array(usageSchema),
    usageCoverage: text,
    cognitionMaintenance: Type.Union([
      Type.Object(
        {
          schedulerEnabled: Type.Union([Type.Boolean(), Type.Null()]),
          subjectEnabled: Type.Union([Type.Boolean(), Type.Null()]),
        },
        object,
      ),
      Type.Null(),
    ]),
    narrativeWork: Type.Array(
      Type.Object(
        {
          briefId: text,
          activityId: text,
          state: text,
          problem: Type.Union([text, Type.Null()]),
          runId: Type.Union([text, Type.Null()]),
        },
        object,
      ),
    ),
    issues: Type.Array(text),
  },
  object,
);
/** Readable derived documents retain revision/source attribution and are never reimported implicitly. */
export const subjectDocumentsSchema = Type.Object(
  { subjectId: text, generatedAt: text, documents: Type.Record(text, text) },
  object,
);
const documentRevisionSchema = Type.Object(
  {
    subjectId: text,
    domain: Type.Union([Type.Literal("self"), Type.Literal("social")]),
    targetRevision: Type.Object({ kind: text, value: text }, object),
    expectedObjectEpoch: Type.String({ pattern: "^[0-9]+$" }),
    content: Type.Record(text, Type.Unknown()),
  },
  object,
);
const documentRevision =
  compileSchema<Static<typeof documentRevisionSchema>>(documentRevisionSchema);
const documentImportSchema = Type.Object(
  {
    document: Type.String({ minLength: 1, maxLength: 1_000_000 }),
    reason: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  object,
);
const documentImportResultSchema = Type.Object(
  {
    subjectId: text,
    results: Type.Array(
      Type.Object(
        {
          targetRevision: text,
          status: Type.Union([
            Type.Literal("unchanged"),
            Type.Literal("revised"),
            Type.Literal("failed"),
          ]),
          revision: Type.Optional(text),
          objectEpoch: Type.Optional(text),
          problem: Type.Optional(text),
        },
        object,
      ),
    ),
  },
  object,
);
const calendarViewSchema = Type.Object(
  {
    subjectId: Type.Union([text, Type.Null()]),
    state: text,
    world: Type.Union([activitySchema.properties.world, Type.Null()]),
    calendar: Type.Union([calendarResultSchema, Type.Null()]),
  },
  object,
);
const calendarQuerySchema = Type.Object(
  {
    period: Type.Optional(
      Type.Union([Type.Literal("today"), Type.Literal("week"), Type.Literal("range")]),
    ),
    from: Type.Optional(text),
    to: Type.Optional(text),
  },
  object,
);
const schoolTemplateSchema = Type.Object(
  {
    id: text,
    timezone: text,
    publishedOn: text,
    effectiveFrom: text,
    source: text,
    lessons: Type.Array(Type.Array(text)),
    otherTimes: Type.Array(
      Type.Object({ title: text, start: text, end: Type.Optional(text) }, object),
    ),
  },
  object,
);
const taskViewSchema = Type.Object(
  {
    activity: activitySchema,
    automaticWorkEnabled: Type.Boolean(),
    retained: Type.Array(
      Type.Object({ runId: text, resultCount: Type.Integer({ minimum: 0 }) }, object),
    ),
    runs: Type.Array(
      Type.Object(
        {
          runId: text,
          role: text,
          purpose: text,
          recordedAt: text,
          dispatchState: text,
          outputProblem: Type.Union([
            Type.Object({ code: text, detail: text }, object),
            Type.Null(),
          ]),
          native: Type.Union([
            Type.Object(
              {
                subjectId: text,
                runId: text,
                agentId: text,
                sessionId: text,
                sessionKey: text,
              },
              object,
            ),
            Type.Null(),
          ]),
          hostInput: Type.Optional(
            Type.Object({ message: text, extraSystemPrompt: text }, object),
          ),
          providerAttempts: Type.Unknown(),
        },
        object,
      ),
    ),
    nextRunId: Type.Union([text, Type.Null()]),
  },
  object,
);
const taskResumeSchema = Type.Object(
  {
    activity: activitySchema,
    automaticWorkEnabled: Type.Boolean(),
    recoveredCandidates: Type.Integer({ minimum: 0 }),
    recoveredRunIds: Type.Array(text),
    blocked: Type.Array(Type.Object({ runId: text, code: text, detail: text }, object)),
  },
  object,
);

/** Installation and existing owner operations used by the authenticated management reads. */
export interface OperatorOptions {
  anchorRoot: string;
  product: ProductManagement;
  gateway: Awaited<ReturnType<typeof createGatewayRuntime>>;
  readNativeChannels: () => Promise<unknown>;
  readProviderAttempts: (params: Record<string, unknown>) => Promise<unknown>;
}
type SelfEntry = Awaited<ReturnType<NousClient["self"]["list"]>>["items"][number];
type SocialEntry = Awaited<ReturnType<NousClient["social"]["list"]>>["items"][number];
const current = (record: SelfEntry | SocialEntry) =>
  record.acceptanceState === "accepted" &&
  record.integrityState === "valid" &&
  record.suppressionState === "normal";
async function readPages<T>(
  read: (token: string) => Promise<{ items: T[]; nextPageToken: string }>,
) {
  const records: T[] = [];
  let token = "";
  do {
    const page = await read(token);
    records.push(...page.items);
    token = page.nextPageToken;
  } while (token);
  return records;
}

/** Reads the bound Subject; document writes require the separate explicit import operation. */
export function createOperatorOperations(options: OperatorOptions) {
  const configured = async () => {
    const { settings } = await options.product.configuration();
    if (!settings)
      throw managementProblem(
        "management.unconfigured",
        "Installation is unconfigured",
        "Configure this installation",
        "unavailable",
      );
    return settings;
  };
  const calendar = async (query: Static<typeof calendarQuerySchema> = {}) => {
    const settings = await configured();
    const subjectId = settings.subject.id,
      worldId = settings.subject.worldId;
    if (!subjectId || !worldId)
      return { subjectId, state: "world_unconfigured", world: null, calendar: null };
    const world = await options.gateway.worldHttp.worlds.read(subjectId, worldId);
    if (!world)
      return { subjectId, state: "world_unavailable", world: null, calendar: null };
    const timezone = world.definition.timezone;
    const clock = await createWorldClockManagement({
      nous: () => connectProductNous(settings),
    })
      .read(subjectId)
      .catch((error) => {
        if (query.period === "range") return null;
        throw error;
      });
    if (clock && clock.world.timeDomainRef !== world.definition.timeDomainRef)
      return {
        subjectId,
        state: "world_clock_domain_mismatch",
        world: clock.world,
        calendar: null,
      };
    let interval: { start: string; end: string };
    if (query.period === "range") {
      if (!query.from || !query.to)
        throw managementProblem(
          "world.range_required",
          "Calendar range is incomplete",
          "Supply --from and --to",
          "validation",
        );
      interval = { start: query.from, end: query.to };
    } else {
      interval = worldCalendarWindow(
        clock!.world.at,
        timezone,
        query.period ?? "today",
      );
    }
    return {
      subjectId,
      state: "available",
      world: clock?.world ?? null,
      calendar: await options.gateway.worldHttp.worlds.readCalendar({
        subjectId,
        worldId,
        interval: { ...interval, timeDomainRef: world.definition.timeDomainRef },
        displayTimezone: timezone,
        perspective: "subject",
        view: "combined",
        limit: 128,
      }),
    };
  };
  const readSelf = async () => {
    const settings = await configured(),
      subjectId = settings.subject.id;
    if (!subjectId)
      throw managementProblem(
        "management.subject_unbound",
        "Subject is not bound",
        "Bind an existing Subject",
        "conflict",
      );
    const nous = await connectProductNous(settings);
    const subject = await nous.subjects.getSubject({ subjectId });
    const selfRecords = subject.capabilities?.selfCognition
      ? (
          await readPages((token) =>
            nous.self.list({ subjectId, page: { pageSize: 100, pageToken: token } }),
          )
        ).filter(current)
      : [];
    return { settings, subjectId, nous, subject, selfRecords };
  };
  const documents = async () => {
    const { settings, subjectId, nous, subject, selfRecords } = await readSelf();
    const socialRecords = subject.capabilities?.socialCognition
      ? (
          await readPages((token) =>
            nous.social.list({ subjectId, page: { pageSize: 100, pageToken: token } }),
          )
        ).filter(current)
      : [];
    const generatedAt = new Date().toISOString();
    const render = (name: string, records: (SelfEntry | SocialEntry)[]) =>
      [
        `# ${name}`,
        `Subject: ${subjectId}\n\n导出时间：${generatedAt}\n\n来源入口：Nous Self/Social 当前对象 → Management /v1/subject/documents；修改使用显式认知修订操作。`,
        ...records.map((record) => {
          const body = record.content?.content;
          if (!body?.case) return "";
          return [
            record.contextText,
            `\n<details>\n<summary>来源与显式修订</summary>\n`,
            `\n精确修订：${record.reference?.kind}:${record.reference?.value}`,
            `\n显式修订块：只编辑下方 content；保留 Subject、修订与 epoch，然后使用 subject documents --import 文件 --reason 说明。读取与编辑文件本身不会改动认知。`,
            "\n```nous-revision\n" +
              JSON.stringify(
                {
                  subjectId,
                  domain: ["facet", "narrative"].includes(body.case)
                    ? "self"
                    : "social",
                  targetRevision: {
                    kind: record.reference!.kind,
                    value: record.reference!.value,
                  },
                  expectedObjectEpoch: record.objectEpoch.toString(),
                  content: ["facet", "narrative"].includes(body.case)
                    ? encodeSelfContent((record as SelfEntry).content!)
                    : encodeSocialContent((record as SocialEntry).content!),
                },
                null,
                2,
              ) +
              "\n```",
            `\n</details>`,
          ].join("\n");
        }),
        records.length ? "" : "未形成。",
      ]
        .filter(Boolean)
        .join("\n\n");
    const identity = selfRecords.filter(
      (r) =>
        r.content?.content.case === "facet" &&
        r.content.content.value.kind === "identity",
    );
    const result: Record<string, string> = {
      "IDENTITY.md": render("当前身份", identity),
      "SOUL.md": render(
        "当前 Self",
        selfRecords.filter((r) => !identity.includes(r)),
      ),
      "RELATIONSHIPS.md": render(
        "当前社会认识",
        socialRecords.filter((r) => r.content?.content.case === "relation"),
      ),
      "LANGUAGE.md": render(
        "当前语言惯例",
        socialRecords.filter((r) => r.content?.content.case === "convention"),
      ),
    };
    const life = settings.subject.worldId
      ? await options.gateway.worldHttp.living({
          subjectId,
          worldId: settings.subject.worldId,
        })
      : null;
    const day = await calendar().catch(() => ({
      state: "clock_unavailable",
      world: null,
      calendar: null,
    }));
    const profile = settings.subject.worldId
      ? await options.gateway.profiles.read(subjectId, settings.subject.worldId)
      : undefined;
    result["LIFE.md"] = [
      "# 当前生活",
      `Subject: ${subjectId}`,
      `导出时间：${generatedAt}`,
      profile
        ? `场景：${profile.profile.name}\n\n入场来源：${profile.entrySourceRef}\n\n原采用说明：${profile.profile.entry.description}`
        : "来源：正式 WorldLife living 与 calendar；尚无已采用场景。",
      life
        ? `地点：${life.currentPlaceRef}\n\n精力：${life.energy} / 100\n\n实际生活记录至：${life.integratedThrough.at}（${life.integratedThrough.timeDomainRef}）\n\n积分说明：${life.energyExplanation}`
        : "世界未配置或尚无生活记录。",
      "## 今日日历",
      day.calendar
        ? day.calendar.items
            .map(
              (item) =>
                `${item.localStart}—${item.localEnd} ${item.planned?.title ?? item.status} [${item.status}]`,
            )
            .join("\n") || "没有已记录安排。"
        : day.state,
    ].join("\n\n");
    return { subjectId, generatedAt, documents: result };
  };
  return {
    documents,
    async resumeTask(activityId: string) {
      const settings = await configured(),
        subjectId = settings.subject.id;
      let activity = subjectId
        ? await options.gateway.life.get(subjectId, activityId)
        : undefined;
      if (!subjectId || !activity || !["active", "paused"].includes(activity.state))
        throw managementProblem(
          "life.resume_unavailable",
          "Original task cannot resume",
          "Choose an active or paused task from this Subject",
          "conflict",
        );
      if (activity.state === "paused" || activity.continuationRequired)
        activity = await options.gateway.life.transition({
          subjectId,
          activityId,
          expectedRevision: activity.revision,
          action: "resume",
          reason: "操作者从任务详情明确恢复原任务",
        });
      const recovered = await options.gateway.recoverRoleOutputs({
        subjectId,
        activityId,
      });
      const candidates = await options.gateway.recoverCandidates({
        subjectId,
        activityId,
      });
      if (settings.subject.enabled)
        await options.gateway.requestReactorOpportunity({
          subjectId,
          activityId,
          operationRef: `operator:task-resume:${activityId}:${activity.revision}`,
        });
      return {
        activity,
        automaticWorkEnabled: settings.subject.enabled,
        recoveredCandidates: candidates.recovered,
        ...recovered,
      };
    },
    async importDocument(input: Static<typeof documentImportSchema>) {
      const { subjectId, nous } = await readSelf();
      const blocks = [
        ...input.document.matchAll(/^```nous-revision\s*\n([\s\S]*?)^```\s*$/gm),
      ];
      if (!blocks.length)
        throw managementProblem(
          "management.document_revision_missing",
          "Document has no explicit revision blocks",
          "Edit the content field in an exported nous-revision block; LIFE changes use Calendar",
          "validation",
        );
      // Decode the whole request before submitting any independent owner mutation.
      const revisions = blocks.map((block) => {
        let parsed: ReturnType<typeof documentRevision.validate>;
        try {
          parsed = documentRevision.validate(JSON.parse(block[1]!));
        } catch {
          throw managementProblem(
            "management.document_invalid",
            "Document revision is not JSON",
            "Edit only content in the exported nous-revision block",
            "validation",
          );
        }
        if (!parsed.ok || parsed.value.subjectId !== subjectId)
          throw managementProblem(
            "management.document_scope_denied",
            "Document revision is invalid or belongs to another Subject",
            "Keep the exported Subject, exact revision and epoch unchanged",
            "validation",
          );
        const value = parsed.value;
        try {
          return value.domain === "self"
            ? {
                ...value,
                domain: "self" as const,
                decoded: decodeSelfContent(
                  value.content as Parameters<typeof decodeSelfContent>[0],
                ),
              }
            : {
                ...value,
                domain: "social" as const,
                decoded: decodeSocialContent(
                  value.content as Parameters<typeof decodeSocialContent>[0],
                ),
              };
        } catch (error) {
          throw managementProblem(
            "management.document_content_invalid",
            "Document content does not match the official cognition type",
            error instanceof Error ? error.message : "Use the exported content type",
            "validation",
          );
        }
      });
      const digest = createHash("sha256").update(input.document).digest("hex");
      const results: Static<typeof documentImportResultSchema>["results"] = [];
      for (const revision of revisions) {
        const targetRevision = `${revision.targetRevision.kind}:${revision.targetRevision.value}`;
        try {
          const request = {
            subjectId,
            id: revision.targetRevision.value,
          };
          const original =
            revision.domain === "self"
              ? await nous.self.getRevision(request)
              : await nous.social.getRevision(request);
          const unchanged =
            revision.domain === "self"
              ? isDeepStrictEqual(
                  encodeSelfContent((original as SelfEntry).content!),
                  encodeSelfContent(revision.decoded),
                )
              : isDeepStrictEqual(
                  encodeSocialContent((original as SocialEntry).content!),
                  encodeSocialContent(revision.decoded),
                );
          if (unchanged) {
            results.push({ targetRevision, status: "unchanged" });
            continue;
          }
          // A manual edit must not retain the old model's producer signature.
          if (revision.decoded.content.value)
            revision.decoded.content.value.producer = undefined;
          const mutation = {
            subjectId,
            operationId: uuidv5(
              `${digest}:${targetRevision}:${input.reason}`,
              "3bf12382-b238-480b-a002-9c37108e5e68",
            ),
            targetRevision: revision.targetRevision,
            expectedObjectEpoch: BigInt(revision.expectedObjectEpoch),
            reason: `Operator document revision (${digest}): ${input.reason}`,
          };
          const result =
            revision.domain === "self"
              ? await nous.self.revise({ ...mutation, content: revision.decoded })
              : await nous.social.revise({ ...mutation, content: revision.decoded });
          results.push({
            targetRevision,
            status: "revised",
            revision: `${result.reference?.kind}:${result.reference?.value}`,
            objectEpoch: result.objectEpoch.toString(),
          });
        } catch (error) {
          results.push({
            targetRevision,
            status: "failed",
            problem: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return { subjectId, results };
    },
    calendar,
    async task(
      activityId: string,
      includeInputs: boolean,
      before?: string,
      runId?: string,
    ) {
      const settings = await configured();
      const subjectId = settings.subject.id;
      const activity = subjectId
        ? await options.gateway.life.get(subjectId, activityId)
        : undefined;
      if (!subjectId || !activity)
        throw managementProblem(
          "life.not_found",
          "Task unavailable",
          "The current Subject has no such task",
          "validation",
        );
      let page = await options.gateway.native.operatorRuns(
        subjectId,
        activityId,
        false,
        before,
        runId,
      );
      const selectedId =
        runId ??
        (includeInputs ? page.runs.find((run) => run.native)?.runId : undefined);
      if (includeInputs && selectedId)
        page = await options.gateway.native.operatorRuns(
          subjectId,
          activityId,
          true,
          undefined,
          selectedId,
        );
      const runs = [];
      for (const run of page.runs) {
        let providerAttempts: unknown = {
          coverage: run.native ? "not_requested" : "not_admitted",
          attempts: [],
        };
        if (run.native && run.runId === selectedId) {
          try {
            providerAttempts = await options.readProviderAttempts({
              ...run.native,
              includeInputs,
            });
          } catch {
            providerAttempts = {
              coverage: "unavailable",
              attempts: [],
              reason: "Native Gateway或正式读取入口未就绪；宿主输入仅单独列出",
            };
          }
        }
        runs.push({ ...run, providerAttempts });
      }
      const retained = (
        await options.gateway.native.readyResults({ subjectId, limit: 128 })
      ).runs
        .filter((run) => run.activityId === activityId)
        .map((run) => ({ runId: run.runId, resultCount: run.resultCount }));
      return {
        activity,
        automaticWorkEnabled: settings.subject.enabled,
        retained,
        runs,
        nextRunId: page.nextRunId,
      };
    },
    async overview() {
      const settings = await configured(),
        subjectId = settings.subject.id;
      const issues: string[] = [];
      let model = "未配置";
      try {
        const profile = JSON.parse(
          await readFile(
            join(options.anchorRoot, "configuration/gateways/subject/openclaw.json"),
            "utf8",
          ),
        );
        model = profile.agents?.defaults?.model?.primary ?? "未配置";
      } catch {
        issues.push("原生模型配置不可读");
      }
      const tasks = subjectId
        ? await options.gateway.life.schedule({
            subjectId,
            states: ["active", "paused", "planned"],
            limit: 128,
          })
        : { activities: [], nextId: null };
      const status = await options.product.status();
      const gatewayStatus = status.dependencies.find(
        (d) => d.name === "subject_gateway",
      );
      if (!settings.subject.enabled) issues.push("自动付费工作已暂停");
      if (subjectId)
        for (const activity of [...tasks.activities]
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .slice(0, 4)) {
          const latest = (
            await options.gateway.native.operatorRuns(
              subjectId,
              activity.activityId,
              false,
            )
          ).runs[0];
          if (latest?.outputProblem)
            issues.push(
              `${activity.purpose.slice(0, 48)}：${latest.outputProblem.detail} · task ${activity.activityId}`,
            );
        }
      if (gatewayStatus?.state !== "available")
        issues.push(gatewayStatus?.message ?? "Subject Gateway未启动");
      let qqState = settings.qq ? "Gateway已停止或未就绪；登录状态未知" : "未配置";
      if (settings.qq && gatewayStatus?.state === "available") {
        try {
          const snapshot = (await options.readNativeChannels()) as {
            channelAccounts?: Record<
              string,
              {
                accountId: string;
                connected?: boolean;
                running?: boolean;
                lastError?: string;
              }[]
            >;
          };
          const account = snapshot.channelAccounts?.["heptalogos-qq"]?.find(
            (account) => account.accountId === settings.qq!.accountId,
          );
          qqState = account?.connected
            ? "已登录并连接"
            : account?.running
              ? "渠道运行中，QQ未登录或未连接"
              : "QQ渠道未运行";
          if (account?.lastError) issues.push(account.lastError);
        } catch {
          qqState = "Gateway在线，渠道状态读取失败";
        }
      }
      let subjectName = "未形成";
      let cognitionMaintenance = null;
      if (subjectId)
        try {
          const { selfRecords, nous } = await readSelf();
          subjectName =
            selfRecords
              .flatMap((record) =>
                record.content?.content.case === "facet" &&
                record.content.content.value.kind === "identity"
                  ? [record.content.content.value.statement]
                  : [],
              )
              .join("；") || "未形成";
          const enabled = async (id?: string) => {
            const snapshot = await nous.configuration.getConfiguration({
              subjectId: id,
              paths: ["maintenance.enabled"],
              exposureCeiling: 3,
            });
            const kind = snapshot.entries.find(
              (entry) => entry.path === "maintenance.enabled",
            )?.value?.kind;
            return kind?.case === "boolValue" ? kind.value : null;
          };
          cognitionMaintenance = {
            schedulerEnabled: await enabled(),
            subjectEnabled: await enabled(subjectId),
          };
        } catch {
          subjectName = "认知暂不可读";
        }
      return {
        status,
        anchorRoot: options.anchorRoot,
        programPath: fileURLToPath(new URL("./", import.meta.url)),
        productGeneration: PRODUCT_GENERATION_ID,
        subjectName,
        model,
        cognitionMaintenance,
        qqAccount: settings.qq?.accountId ?? null,
        qqState,
        tasks: tasks.activities,
        moreTasks: tasks.nextId !== null,
        retainedResults: subjectId
          ? (
              await options.gateway.native.readyResults({ subjectId, limit: 128 })
            ).runs.map((run) => ({
              activityId: run.activityId,
              runId: run.runId,
              resultCount: run.resultCount,
            }))
          : [],
        foreground: subjectId
          ? ((await options.gateway.foreground.current(subjectId)) ?? null)
          : null,
        living:
          subjectId && settings.subject.worldId
            ? ((await options.gateway.worldHttp.living({
                subjectId,
                worldId: settings.subject.worldId,
              })) ?? null)
            : null,
        usage: subjectId ? await options.gateway.native.operatorUsage(subjectId) : [],
        usageCoverage:
          "统计已留存的模型用量；其他登记是否提交provider、未留存用量与价格均为未知",
        narrativeWork: subjectId
          ? await options.gateway.pendingNarrative(subjectId)
          : [],
        issues,
      };
    },
  };
}

/** Public management reads share administrator authentication and generated Client contracts. */
export function registerOperatorHttp(
  app: FastifyInstance,
  authenticate: (token: string | undefined) => Promise<void>,
  reads?: ReturnType<typeof createOperatorOperations>,
) {
  const available = () =>
    reads ??
    (() => {
      throw managementProblem(
        "management.operator_unavailable",
        "Operator reads unavailable",
        "Use the installed Host",
        "unavailable",
      );
    })();
  const common = {
    onRequest: async (request: import("fastify").FastifyRequest) =>
      authenticate(request.headers.authorization?.replace(/^Bearer /u, "")),
  };
  const errors = {
    400: managementProblemSchema,
    401: managementProblemSchema,
    503: managementProblemSchema,
    500: managementProblemSchema,
  };
  app.get(
    "/v1/overview",
    {
      ...common,
      schema: {
        operationId: "getOperatorOverview",
        security: [{ bearerAuth: [] }],
        response: { 200: operatorOverviewSchema, ...errors },
      },
    },
    () => available().overview(),
  );
  app.get(
    "/v1/subject/documents",
    {
      ...common,
      schema: {
        operationId: "getSubjectDocuments",
        security: [{ bearerAuth: [] }],
        response: { 200: subjectDocumentsSchema, ...errors },
      },
    },
    () => available().documents(),
  );
  app.post(
    "/v1/subject/documents/import",
    {
      ...common,
      bodyLimit: 4 * 1024 * 1024,
      schema: {
        operationId: "importSubjectDocument",
        body: documentImportSchema,
        security: [{ bearerAuth: [] }],
        response: { 200: documentImportResultSchema, ...errors },
      },
    },
    (request) =>
      available().importDocument(request.body as Static<typeof documentImportSchema>),
  );
  app.get(
    "/v1/tasks/:activityId",
    {
      ...common,
      schema: {
        operationId: "getTaskDetails",
        params: Type.Object({ activityId: text }, object),
        querystring: Type.Object(
          {
            inputs: Type.Optional(Type.Literal("true")),
            before: Type.Optional(text),
            runId: Type.Optional(text),
          },
          object,
        ),
        security: [{ bearerAuth: [] }],
        response: { 200: taskViewSchema, ...errors },
      },
    },
    (request) => {
      const query = request.query as {
        inputs?: string;
        before?: string;
        runId?: string;
      };
      return available().task(
        (request.params as { activityId: string }).activityId,
        query.inputs === "true",
        query.before,
        query.runId,
      );
    },
  );
  app.post(
    "/v1/tasks/:activityId/resume",
    {
      ...common,
      schema: {
        operationId: "resumeTask",
        params: Type.Object({ activityId: text }, object),
        security: [{ bearerAuth: [] }],
        response: { 200: taskResumeSchema, ...errors },
      },
    },
    (request) =>
      available().resumeTask((request.params as { activityId: string }).activityId),
  );
  app.get(
    "/v1/calendar/template",
    {
      ...common,
      schema: {
        operationId: "getSchoolTimeTemplate",
        security: [{ bearerAuth: [] }],
        response: { 200: schoolTemplateSchema, ...errors },
      },
    },
    () => schoolCalendarTemplate,
  );
  app.get(
    "/v1/calendar",
    {
      ...common,
      schema: {
        operationId: "getDefaultCalendar",
        querystring: calendarQuerySchema,
        security: [{ bearerAuth: [] }],
        response: { 200: calendarViewSchema, ...errors },
      },
    },
    (request) =>
      available().calendar(request.query as Static<typeof calendarQuerySchema>),
  );
}
