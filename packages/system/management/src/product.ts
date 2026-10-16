// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product management without an agent runtime or a dependency readiness gate.
 * @module product
 */
import type {
  ConfigurationDefinition,
  ConfigurationDefinitionId,
  ConfigurationRevision,
  ConfigurationScopeRef,
  ConfigurationService,
} from "@heptalogos/configuration";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CanonicalJsonValue } from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { invalidInputProblem, managementProblem } from "./problems.js";

/** Operator-adopted QQ and native tool grants; ordinary chat cannot modify this configuration. */
export const qqAuthorizationSchema = Type.Object(
  {
    accountId: Type.String({ minLength: 1, maxLength: 128 }),
    nativeAgentId: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" }),
    conversations: Type.Array(
      Type.Object(
        {
          kind: Type.Union([Type.Literal("group"), Type.Literal("direct")]),
          conversationId: Type.String({ minLength: 1, maxLength: 128 }),
          receive: Type.Boolean(),
          observe: Type.Boolean(),
          effects: Type.Array(
            Type.Union([
              Type.Literal("send"),
              Type.Literal("edit"),
              Type.Literal("withdraw"),
              Type.Literal("react"),
              Type.Literal("moderate"),
              Type.Literal("accept_request"),
            ]),
            { uniqueItems: true, maxItems: 6 },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 128 },
    ),
    tools: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    sourceRefs: Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    maxRunMs: Type.Integer({ minimum: 1000, maximum: 3600000 }),
  },
  { additionalProperties: false },
);

/** Product duties select native profiles; provider/model/credentials remain native-owned. */
export const subjectRoleBindingSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal("world.planner"),
      Type.Literal("subject.deliberation"),
      Type.Literal("subject.execution"),
      Type.Literal("subject.render"),
      Type.Literal("narrative.review"),
    ]),
    nativeAgentRef: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" }),
    enabled: Type.Boolean(),
    outputContract: Type.Union([
      Type.Literal("natural_text"),
      Type.Literal("structured_json"),
    ]),
    deadlineMs: Type.Integer({ minimum: 1000, maximum: 3_600_000 }),
    outputTokens: Type.Integer({ minimum: 128, maximum: 65536 }),
    inputTokens: Type.Integer({ minimum: 1024, maximum: 2_097_152 }),
    allowedTools: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    fallbackAgentRefs: Type.Array(
      Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,63}$" }),
      { maxItems: 8, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
);
/** Duties have independently configurable native execution and bounded resources. */
export type SubjectRoleBinding = Static<typeof subjectRoleBindingSchema>;

/** Settings owned and consumed by the product host; credentials remain secret references. */
export const productSettingsSchema = Type.Object(
  {
    qq: Type.Optional(qqAuthorizationSchema),
    roles: Type.Optional(Type.Array(subjectRoleBindingSchema, { maxItems: 5 })),
    nous: Type.Object(
      {
        runRoot: Type.String({ minLength: 1 }),
        expectedInstanceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    subject: Type.Object(
      {
        id: Type.Union([
          Type.String({
            pattern:
              "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
          }),
          Type.Null(),
        ]),
        enabled: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    subjectGateway: Type.Object(
      {
        origin: Type.String({ pattern: "^http://127\\.0\\.0\\.1:[0-9]+/?$" }),
      },
      { additionalProperties: false },
    ),
    maintenanceGateway: Type.Object(
      {
        origin: Type.String({ pattern: "^http://127\\.0\\.0\\.1:[0-9]+/?$" }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
/** Effective host configuration, independent of native model/tool and Nous algorithm settings. */
export type ProductSettings = Static<typeof productSettingsSchema>;
/** Configuration namespace consumed by the headless host. */
export const PRODUCT_SETTINGS_ID = "product.host.v1" as ConfigurationDefinitionId;
/** Sole product-settings definition, including validation and activation semantics. */
export const productSettingsDefinition: ConfigurationDefinition = {
  schemaVersion: 1,
  definitionId: PRODUCT_SETTINGS_ID,
  owner: "product.host",
  version: 1,
  scopeKind: "INSTALLATION",
  valueSchema: productSettingsSchema as unknown as CanonicalJsonValue,
  classification: "INSTALLATION_CONFIG",
  visibility: "NORMAL",
  manageability: "EDITABLE",
  activation: "LIVE",
  sensitivity: "INTERNAL",
  defaultAuthority: "NO_DEFAULT_REQUIRED",
  consumerRefs: ["product-host", "management"],
};
/** Public identity descriptor checked against the installed locator. */
export const productDiscoverySchema = Type.Object(
  {
    installationId: Type.String(),
    bootId: Type.String(),
    apiBasePath: Type.Literal("/v1"),
    contractVersion: Type.Literal("management.v1"),
  },
  { additionalProperties: false },
);

/** One truthful dependency observation; successful HTTP is scoped to the inspected endpoint. */
const dependencyStatusSchema = Type.Object(
  {
    name: Type.String(),
    state: Type.Union([
      Type.Literal("available"),
      Type.Literal("unavailable"),
      Type.Literal("unconfigured"),
    ]),
    checkedAt: Type.String(),
    code: Type.String(),
    message: Type.String(),
    nextStep: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
/** Dependency status used by both API generation and host probes. */
export type DependencyStatus = Static<typeof dependencyStatusSchema>;
/** Aggregate management status; does not claim model or QQ readiness from Gateway HTTP. */
export const productStatusSchema = Type.Object(
  {
    installationId: Type.String(),
    bootId: Type.String(),
    startedAt: Type.String(),
    management: Type.Literal("available"),
    subject: Type.Object({
      id: Type.Union([Type.String(), Type.Null()]),
      enabled: Type.Boolean(),
    }),
    configurationRevision: Type.Union([Type.String(), Type.Null()]),
    dependencies: Type.Array(dependencyStatusSchema),
    capabilities: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
/** Stable status response. */
export type ProductStatus = Static<typeof productStatusSchema>;
/** Configuration read response with real CAS revision. */
export const productConfigurationSchema = Type.Object(
  {
    revision: Type.Union([Type.String(), Type.Null()]),
    settings: Type.Union([productSettingsSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
/** Input for one exact configuration replacement, not a merge with hidden defaults. */
export const configureProductSchema = Type.Object(
  {
    expectedRevision: Type.Union([Type.String(), Type.Null()]),
    settings: productSettingsSchema,
  },
  { additionalProperties: false },
);
/** A management projection of the Subject owned by Nous, never a cognition copy. */
export const managedSubjectSchema = Type.Object(
  {
    subjectId: Type.String(),
    status: Type.String(),
    memory: Type.Boolean(),
    selfCognition: Type.Boolean(),
  },
  { additionalProperties: false },
);
/** Public projection of the Subject owned by Nous. */
export type ManagedSubject = Static<typeof managedSubjectSchema>;
/** Idempotent creation input with an optional explicit Seed. */
export const createProductSubjectSchema = Type.Object(
  {
    operationId: Type.String({ minLength: 1 }),
    capabilities: Type.Object(
      { memory: Type.Boolean(), selfCognition: Type.Boolean() },
      { additionalProperties: false },
    ),
    seed: Type.Optional(
      Type.Object(
        {
          text: Type.String({ minLength: 1 }),
          format: Type.Union([Type.Literal("markdown"), Type.Literal("toml")]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
/** Schema-owned Subject creation input. */
export type CreateProductSubject = Static<typeof createProductSubjectSchema>;
/** Explicit binding request with expected configuration revision. */
export const bindProductSubjectSchema = Type.Object(
  {
    subjectId: Type.String({ minLength: 1 }),
    expectedRevision: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
/** Binding plus its currently observed cognition availability. */
export const boundSubjectSchema = Type.Object(
  {
    binding: productSettingsSchema.properties.subject,
    subject: Type.Union([managedSubjectSchema, Type.Null()]),
    state: Type.Union([
      Type.Literal("available"),
      Type.Literal("unavailable"),
      Type.Literal("unbound"),
    ]),
  },
  { additionalProperties: false },
);
/** Schema-owned binding observation. */
export type BoundSubject = Static<typeof boundSubjectSchema>;

/** Host-provided runtime facts and canonical mutation execution. */
export interface ProductManagementOptions {
  readonly configuration: ConfigurationService;
  readonly installationId: string;
  readonly bootId: string;
  readonly startedAt: string;
  readonly dependencies: (
    settings: ProductSettings | undefined,
    signal?: AbortSignal,
  ) => Promise<readonly DependencyStatus[]>;
  readonly runMutation: <T>(kind: string, operation: () => Promise<T>) => Promise<T>;
  readonly subjects: {
    get(
      settings: ProductSettings,
      id: string,
      signal?: AbortSignal,
    ): Promise<ManagedSubject>;
    create(
      settings: ProductSettings,
      input: CreateProductSubject,
      signal?: AbortSignal,
    ): Promise<ManagedSubject>;
  };
}
const validator = compileSchema<ProductSettings>(productSettingsSchema);

/** Normal management operations that remain usable with stopped model, Nous and QQ dependencies. */
export class ProductManagement {
  private readonly scope: ConfigurationScopeRef;
  /** Binds installation identity to the canonical configuration owner. */
  constructor(private readonly options: ProductManagementOptions) {
    this.scope = {
      schemaVersion: 1,
      resourceKind: "installation",
      resourceId: options.installationId,
    };
  }
  /** Returns current settings from their one canonical owner. */
  async configuration(transaction?: PersistenceInternalTransaction): Promise<{
    revision: string | null;
    settings: ProductSettings | null;
  }> {
    const current = await this.current(transaction);
    if (!current) return { revision: null, settings: null };
    const checked = validator.validate(current.value);
    if (!checked.ok)
      throw managementProblem(
        "management.configuration_invalid",
        "Configuration is invalid",
        "Inspect the active product.host.v1 revision",
        "integrity",
      );
    return { revision: current.revisionId, settings: checked.value };
  }
  /** Reads live dependencies without requiring any one to be usable. */
  async status(signal?: AbortSignal): Promise<ProductStatus> {
    const config = await this.configuration();
    const dependencies = await this.options.dependencies(
      config.settings ?? undefined,
      signal,
    );
    return {
      installationId: this.options.installationId,
      bootId: this.options.bootId,
      startedAt: this.options.startedAt,
      management: "available",
      subject: config.settings?.subject ?? { id: null, enabled: false },
      configurationRevision: config.revision,
      dependencies: [...dependencies],
      capabilities: ["management", "configuration", "subject_binding"],
    };
  }
  /** Validates only; no model calls, files or durable revisions are created. */
  check(settings: unknown): ProductSettings {
    const checked = validator.validate(settings);
    if (!checked.ok)
      throw invalidInputProblem("Product configuration does not match its schema");
    for (const endpoint of [
      checked.value.subjectGateway.origin,
      checked.value.maintenanceGateway.origin,
    ]) {
      try {
        new URL(endpoint);
      } catch {
        throw invalidInputProblem("A dependency endpoint has an invalid port");
      }
    }
    if (checked.value.qq) {
      const keys = checked.value.qq.conversations.map(
        (c) => c.kind + ":" + c.conversationId,
      );
      if (new Set(keys).size !== keys.length)
        throw invalidInputProblem(
          "Each QQ conversation must have one explicit current grant",
        );
      if (
        checked.value.qq.conversations.some(
          (c) => !c.receive && (c.observe || c.effects.length > 0),
        )
      )
        throw invalidInputProblem(
          "Observation and effects require an adopted receive conversation",
        );
    }
    if (!isAbsolute(checked.value.nous.runRoot))
      throw invalidInputProblem("Nous runRoot must be absolute");
    if (checked.value.subject.enabled && checked.value.subject.id === null)
      throw invalidInputProblem("Bind a Subject before enabling it");
    return checked.value;
  }
  /** Replaces settings with exact expected revision and activates through Configuration. */
  async configure(
    settings: unknown,
    expectedRevision: string | null,
    signal?: AbortSignal,
  ) {
    const value = this.check(settings);
    const current = await this.current();
    if ((current?.revisionId ?? null) !== expectedRevision)
      throw managementProblem(
        "management.configuration_conflict",
        "Configuration changed",
        "Read the current revision and submit the intended change again",
        "conflict",
      );
    const previous = current?.value as ProductSettings | undefined;
    if (
      previous?.subject.enabled &&
      (previous.subject.id !== value.subject.id ||
        !isDeepStrictEqual(previous.nous, value.nous) ||
        previous.qq?.accountId !== value.qq?.accountId ||
        previous.qq?.nativeAgentId !== value.qq?.nativeAgentId)
    )
      throw managementProblem(
        "management.subject_active",
        "Pause the current Subject first",
        "A running Subject, Nous instance or QQ account binding cannot be silently replaced through configuration",
        "conflict",
      );
    if (
      value.subject.id &&
      (previous?.subject.id !== value.subject.id ||
        !isDeepStrictEqual(previous?.nous, value.nous))
    )
      await this.options.subjects.get(value, value.subject.id, signal);
    const revision = await this.options.runMutation(
      "product.configuration.revise",
      () =>
        this.options.configuration.createRevision({
          definitionId: PRODUCT_SETTINGS_ID,
          scopeRef: this.scope,
          value: value as CanonicalJsonValue,
        }),
    );
    await this.options.runMutation("product.configuration.activate", () =>
      this.options.configuration.activate({
        revisionId: revision.revisionId,
        ...(expectedRevision === null
          ? {}
          : { expectedActiveRevisionId: expectedRevision }),
      }),
    );
    return this.configuration();
  }
  /** Reads the binding even when cognition or model execution is unavailable. */
  async subject(signal?: AbortSignal): Promise<BoundSubject> {
    const { settings } = await this.configuration();
    if (!settings?.subject.id)
      return {
        binding: settings?.subject ?? { id: null, enabled: false },
        subject: null,
        state: "unbound",
      };
    try {
      return {
        binding: settings.subject,
        subject: await this.options.subjects.get(settings, settings.subject.id, signal),
        state: "available",
      };
    } catch {
      return { binding: settings.subject, subject: null, state: "unavailable" };
    }
  }
  /** Binding is explicit and verifies the actual owning Nous Subject. */
  async bindSubject(id: string, expectedRevision: string, signal?: AbortSignal) {
    const { settings } = await this.configuration();
    if (!settings)
      throw invalidInputProblem("Configure the Nous instance before binding a Subject");
    if (settings.subject.enabled && settings.subject.id !== id)
      throw managementProblem(
        "management.subject_active",
        "Pause the current Subject first",
        "A running Subject cannot be silently replaced",
        "conflict",
      );
    return this.configure(
      { ...settings, subject: { ...settings.subject, id } },
      expectedRevision,
      signal,
    );
  }
  /** Creates through Nous without replacing an existing binding or invoking a model. */
  async createSubject(input: CreateProductSubject, signal?: AbortSignal) {
    const { settings } = await this.configuration();
    if (!settings)
      throw invalidInputProblem(
        "Configure the Nous instance before creating a Subject",
      );
    return this.options.subjects.create(settings, input, signal);
  }
  private current(
    transaction?: PersistenceInternalTransaction,
  ): Promise<ConfigurationRevision | undefined> {
    return this.options.configuration.getEffectiveRevision(
      PRODUCT_SETTINGS_ID,
      this.scope,
      transaction,
    );
  }
}
