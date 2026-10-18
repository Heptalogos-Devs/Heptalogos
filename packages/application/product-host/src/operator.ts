// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Deterministic operator views over current owners; no generation or lifecycle mutation.
 * @module operator
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import {
  activitySchema,
  calendarResultSchema,
  subjectReactionSchema,
  worldLivingStateSchema,
  worldCalendarWindow,
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
    issues: Type.Array(text),
  },
  object,
);
/** Readable derived documents retain revision/source attribution and are never reimported implicitly. */
export const subjectDocumentsSchema = Type.Object(
  { subjectId: text, generatedAt: text, documents: Type.Record(text, text) },
  object,
);
const calendarViewSchema = Type.Object(
  {
    subjectId: Type.Union([text, Type.Null()]),
    state: text,
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

/** Installation and existing owner operations used by the authenticated management reads. */
export interface OperatorReadOptions {
  anchorRoot: string;
  product: ProductManagement;
  gateway: Awaited<ReturnType<typeof createGatewayRuntime>>;
}
const fieldNames: Record<string, string> = {
  kind: "类型",
  statement: "内容",
  stance: "立场",
  scope: "适用范围",
  validTime: "有效时间",
  epistemicClass: "认识地位",
  exceptions: "反例与边界",
  theme: "主题",
  interpretation: "理解",
  fromEntityRef: "从",
  toEntityRef: "至",
  relationType: "关系",
  degree: "程度",
  confidence: "确信",
  expression: "用语",
  meaning: "含义",
  variants: "其他写法",
  explanation: "说明",
};
const display = (value: unknown) =>
  typeof value === "string"
    ? value
    : JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? String(v) : v));

/** Composes the actual bound Subject without a provider, pending-work flush or source contact. */
export function createOperatorReads(options: OperatorReadOptions) {
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
      return { subjectId, state: "world_unconfigured", calendar: null };
    const world = await options.gateway.worldHttp.worlds.read(subjectId, worldId);
    if (!world) return { subjectId, state: "world_unavailable", calendar: null };
    const timezone = world.definition.timezone;
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
      const clock = await createWorldClockManagement({
        nous: () => connectProductNous(settings),
      }).read(subjectId);
      interval = worldCalendarWindow(clock.world.at, timezone, query.period ?? "today");
    }
    return {
      subjectId,
      state: "available",
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
  const documents = async () => {
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
    const self: Awaited<ReturnType<typeof nous.self.list>>["items"] = [];
    const social: Awaited<ReturnType<typeof nous.social.list>>["items"] = [];
    for (const [enabled, service, records] of [
      [subject.capabilities?.selfCognition, nous.self, self],
      [subject.capabilities?.socialCognition, nous.social, social],
    ] as const) {
      if (!enabled) continue;
      let token = "";
      do {
        const page = await service.list({
          subjectId,
          page: { pageSize: 128, pageToken: token },
        });
        (records as (typeof page.items)[number][]).push(...page.items);
        token = page.nextPageToken;
      } while (token);
    }
    const current = (record: (typeof self)[number] | (typeof social)[number]) =>
      record.acceptanceState === "accepted" &&
      record.integrityState === "valid" &&
      record.suppressionState === "normal";
    const selfRecords = self.filter(current),
      socialRecords = social.filter(current);
    const generatedAt = new Date().toISOString();
    const render = (
      name: string,
      records: ((typeof self)[number] | (typeof social)[number])[],
    ) =>
      [
        `# ${name}`,
        `Subject: ${subjectId}\n\n导出时间：${generatedAt}\n\n来源入口：Nous Self/Social 当前对象 → Management /v1/subject/documents；修改使用显式认知修订操作。`,
        ...records.map((record) => {
          const body = record.content?.content;
          if (!body?.case) return "";
          return [
            `## ${body.case}`,
            ...Object.entries(body.value)
              .filter(([key]) => !key.startsWith("$"))
              .map(([key, value]) => `- ${fieldNames[key] ?? key}：${display(value)}`),
            `\n精确修订：${record.reference?.kind}:${record.reference?.value}`,
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
      calendar: null,
    }));
    result["LIFE.md"] = [
      "# 当前生活",
      `Subject: ${subjectId}`,
      `导出时间：${generatedAt}`,
      "来源：正式 WorldLife living 与 calendar；学生世界为既有开发场景，未增加用户未提供的人设。",
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
    calendar,
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
      if (gatewayStatus?.state !== "available")
        issues.push(gatewayStatus?.message ?? "Subject Gateway未启动");
      let subjectName = "未形成";
      if (subjectId)
        try {
          const current = await documents();
          const identity = current.documents["IDENTITY.md"];
          subjectName = /- 内容：([^\n]+)/u.exec(identity ?? "")?.[1] ?? "未形成";
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
        qqAccount: settings.qq?.accountId ?? null,
        qqState: settings.qq
          ? gatewayStatus?.state === "available"
            ? "Gateway在线，登录状态待渠道核实"
            : "Gateway已停止或未就绪；登录状态未知"
          : "未配置",
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
          "Host保留结果的用量；缺失调用和未核实价格标未知，原生配置中的零价格不作为免费依据",
        issues,
      };
    },
  };
}

/** Public management reads share administrator authentication and generated Client contracts. */
export function registerOperatorHttp(
  app: FastifyInstance,
  authenticate: (token: string | undefined) => Promise<void>,
  reads?: ReturnType<typeof createOperatorReads>,
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
