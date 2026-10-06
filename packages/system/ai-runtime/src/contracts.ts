// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the current gateway-first Product AI runtime contracts, persistent
 * profile shapes, exact Subject bindings, and structured invocation boundary.
 * @module contracts
 */

import type {
  ActivityId,
  CanonicalJsonValue,
  Instant,
  UuidV7Id,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContextRuntime,
  LineageContextRef,
} from "@heptalogos/execution-lineage";
import type { EvidenceRef, EvidenceService } from "@heptalogos/evidence";
import type {
  ConfigurationRevisionId,
  ConfigurationService,
} from "@heptalogos/configuration";
import type { NetworkAccessService } from "@heptalogos/network-access";
import type { PersistenceService } from "@heptalogos/persistence";
import type { SecretRef, SecretService } from "@heptalogos/secret";
import type { TimeService } from "@heptalogos/time-service";
import { Type } from "@heptalogos/schema-runtime/typebox";

/** Identifies one persisted GatewayProfile. */
export type GatewayProfileId = UuidV7Id<"GatewayProfileId">;
/** Identifies one persisted ModelProfile. */
export type ModelProfileId = UuidV7Id<"ModelProfileId">;
/** Identifies one persisted ModelBinding. */
export type ModelBindingId = UuidV7Id<"ModelBindingId">;
/** Identifies one process-local invocation. */
export type InvocationId = UuidV7Id<"InvocationId">;

/** The exact capability set used by the current Subject provider route. */
export type ModelCapability =
  "text-generation" | "structured-output" | "usage-metadata" | "abort-timeout";

/** The exact current model capability set in stable order. */
export const CURRENT_MODEL_CAPABILITIES: readonly ModelCapability[] = Object.freeze([
  "text-generation",
  "structured-output",
  "usage-metadata",
  "abort-timeout",
]);

/** The current OpenAI-family invocation protocols. */
export type ModelInvocationProtocol = "openai-chat" | "openai-responses";

/** Persistent configured model gateway endpoint. */
export interface GatewayProfile {
  readonly schemaVersion: 1;
  readonly gatewayProfileId: GatewayProfileId;
  readonly baseUrl: string;
  readonly apiTokenSecretRef?: SecretRef;
  readonly enabled: boolean;
}

/** Persistent gateway/model/protocol configuration and replacement generation. */
export interface ModelProfile {
  readonly schemaVersion: 1;
  readonly modelProfileId: ModelProfileId;
  readonly gatewayProfileId: GatewayProfileId;
  readonly modelIdentifier: string;
  readonly protocol: ModelInvocationProtocol;
  readonly consumedCapabilities: readonly ModelCapability[];
  readonly generation: number;
}

/** Persistent exact Subject model binding and its revision. */
export interface ModelBinding {
  readonly schemaVersion: 1;
  readonly modelBindingId: ModelBindingId;
  readonly role: "subject.primary" | "subject.expression";
  readonly modelProfileId: ModelProfileId;
  readonly revision: number;
  readonly enabled: boolean;
}

/** Provider-neutral model route facts used by a caller-owned commit fence. */
export interface ModelBindingCommitProvenance {
  readonly modelBindingId: ModelBindingId;
  readonly bindingRevision: number;
  readonly modelProfileId: ModelProfileId;
  readonly modelProfileGeneration: number;
  readonly gatewayProfileId: GatewayProfileId;
  readonly modelIdentifier: string;
  readonly protocol: ModelInvocationProtocol;
}

/** Provider-neutral ephemeral message accepted by AIRuntime. */
export type AIRuntimeMessage =
  | { readonly role: "system"; readonly text: string }
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "assistant"; readonly text: string };

/** The only current invocation budget. */
export interface InvocationBudget {
  readonly maxOutputTokens: number;
}

/** One exact, provider-neutral structured invocation request. */
export interface InvocationSpec {
  readonly schemaVersion: 1;
  readonly invocationId: InvocationId;
  readonly ownerActivityRef: ActivityId;
  readonly modelBindingId: ModelBindingId;
  readonly expectedBindingRevision: number;
  readonly contextProjection: CanonicalJsonValue;
  readonly messages: readonly AIRuntimeMessage[];
  readonly objective: string;
  readonly outputSchema: CanonicalJsonValue;
  readonly budget: InvocationBudget;
  readonly deadline?: Instant;
  readonly lineageContextRef: LineageContextRef;
}

/** Narrow usage metadata retained from the selected AI SDK result. */
export interface UsageMetadata {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

/** One structured provider result before a consuming owner commits it. */
export interface GenerationResult {
  readonly schemaVersion: 1;
  readonly invocationId: InvocationId;
  readonly modelBindingId: ModelBindingId;
  readonly bindingRevision: number;
  readonly gatewayProfileId: GatewayProfileId;
  readonly modelProfileId: ModelProfileId;
  readonly modelProfileGeneration: number;
  readonly modelIdentifier: string;
  readonly protocol: ModelInvocationProtocol;
  readonly configurationRevisionId: ConfigurationRevisionId;
  readonly candidate: CanonicalJsonValue;
  readonly usage?: UsageMetadata;
  readonly lineageContextRef: LineageContextRef;
  readonly evidenceRefs: readonly EvidenceRef[];
}

/** Read-only reasoned provider readiness projection. */
export interface AIRuntimeReadiness {
  readonly schemaVersion: 1;
  readonly state: "READY" | "BLOCKED";
  readonly blockers: readonly string[];
}

/** Input to the current GatewayProfile action. */
export interface SetGatewayProfileInput {
  readonly gatewayProfileId?: GatewayProfileId | string;
  readonly baseUrl: string;
  readonly apiTokenSecretRef?: SecretRef;
  readonly enabled: boolean;
}

/** Input to the current ModelProfile action. */
export interface SetModelProfileInput {
  readonly modelProfileId?: ModelProfileId | string;
  readonly gatewayProfileId: GatewayProfileId | string;
  readonly modelIdentifier: string;
  readonly protocol: ModelInvocationProtocol;
  readonly consumedCapabilities: readonly ModelCapability[];
}

/** Input to the current ModelBinding action. */
export interface SetModelBindingInput {
  readonly role: "subject.primary" | "subject.expression";
  readonly modelProfileId: ModelProfileId | string;
}

/** Options binding AIRuntime to current semantic owners. */
export interface AIRuntimeServiceOptions {
  readonly persistence: PersistenceService;
  readonly time: TimeService;
  readonly execution: ExecutionContextRuntime;
  readonly evidence: EvidenceService;
  readonly configuration: ConfigurationService;
  readonly secret: SecretService;
  readonly networkAccess: NetworkAccessService;
}

/** Current AIRuntime semantic service. */
export interface AIRuntimeService {
  /** Lists persisted gateway profiles. */
  listGatewayProfiles(): Promise<readonly GatewayProfile[]>;
  /** Lists persisted model profiles. */
  listModelProfiles(): Promise<readonly ModelProfile[]>;
  /** Lists the exact current model bindings. */
  listModelBindings(): Promise<readonly ModelBinding[]>;
  /** Reads one gateway profile. */
  getGatewayProfile(id: GatewayProfileId | string): Promise<GatewayProfile | undefined>;
  /** Reads one model profile. */
  getModelProfile(id: ModelProfileId | string): Promise<ModelProfile | undefined>;
  /** Reads one binding by role or identifier. */
  getModelBinding(roleOrId: ModelBindingId | string): Promise<ModelBinding | undefined>;
  /** Creates or replaces one configured gateway endpoint. */
  setGatewayProfile(
    input: SetGatewayProfileInput,
    expectedDigest?: string | null,
  ): Promise<GatewayProfile>;
  /** Creates or replaces one model profile. */
  setModelProfile(
    input: SetModelProfileInput,
    expectedDigest?: string | null,
  ): Promise<ModelProfile>;
  /** Creates or replaces one exact Subject binding. */
  setModelBinding(
    input: SetModelBindingInput,
    expectedDigest?: string | null,
  ): Promise<ModelBinding>;
  /** Reports whether the current binding route is invokable. */
  getReadiness(): Promise<AIRuntimeReadiness>;
  /** Validates generation provenance inside a caller-owned canonical transaction. */
  assertGenerationAdmissibleForCommit(
    transaction: import("@heptalogos/persistence").PersistenceMutationTransactionContext,
    provenance: GenerationResult,
  ): Promise<void>;
  /** Validates the selected model route without claiming AIRuntime invoked it. */
  assertModelBindingAdmissibleForCommit(
    transaction: import("@heptalogos/persistence").PersistenceMutationTransactionContext,
    provenance: ModelBindingCommitProvenance,
  ): Promise<void>;
  /** Invokes one ephemeral structured generation. */
  invoke(spec: InvocationSpec): Promise<GenerationResult>;
}

const capabilitySchema = Type.Union([
  Type.Literal("text-generation"),
  Type.Literal("structured-output"),
  Type.Literal("usage-metadata"),
  Type.Literal("abort-timeout"),
]);
const secretRefSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    secretId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const modelInvocationProtocolSchema = Type.Union([
  Type.Literal("openai-chat"),
  Type.Literal("openai-responses"),
]);

/** JSON Schema for GatewayProfile reads. */
export const gatewayProfileSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    gatewayProfileId: Type.String({ minLength: 1 }),
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    apiTokenSecretRef: Type.Optional(secretRefSchema),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** JSON Schema for GatewayProfile action input. */
export const gatewayProfileSetInputSchema = Type.Object(
  {
    gatewayProfileId: Type.Optional(Type.String({ minLength: 1 })),
    baseUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    apiTokenSecretRef: Type.Optional(secretRefSchema),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** JSON Schema for ModelProfile reads. */
export const modelProfileSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    modelProfileId: Type.String({ minLength: 1 }),
    gatewayProfileId: Type.String({ minLength: 1 }),
    modelIdentifier: Type.String({ minLength: 1, maxLength: 256 }),
    protocol: modelInvocationProtocolSchema,
    consumedCapabilities: Type.Array(capabilitySchema, { minItems: 1, maxItems: 4 }),
    generation: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/** JSON Schema for ModelProfile action input. */
export const modelProfileSetInputSchema = Type.Object(
  {
    modelProfileId: Type.Optional(Type.String({ minLength: 1 })),
    gatewayProfileId: Type.String({ minLength: 1 }),
    modelIdentifier: Type.String({ minLength: 1, maxLength: 256 }),
    protocol: modelInvocationProtocolSchema,
    consumedCapabilities: Type.Array(capabilitySchema, {
      minItems: 1,
      maxItems: 4,
    }),
  },
  { additionalProperties: false },
);

/** JSON Schema for ModelBinding reads. */
export const modelBindingSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    modelBindingId: Type.String({ minLength: 1 }),
    role: Type.Union([
      Type.Literal("subject.primary"),
      Type.Literal("subject.expression"),
    ]),
    modelProfileId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 1 }),
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** JSON Schema for ModelBinding action input. */
export const modelBindingSetInputSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal("subject.primary"),
      Type.Literal("subject.expression"),
    ]),
    modelProfileId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** JSON Schema for AIRuntime readiness. */
export const aiRuntimeReadinessSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    state: Type.Union([Type.Literal("READY"), Type.Literal("BLOCKED")]),
    blockers: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
