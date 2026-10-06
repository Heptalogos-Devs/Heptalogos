// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the current Management wire contracts and read projections.
 * Transport adapters consume these schemas without owning their semantics.
 * @module contracts
 */

import type {
  BootId,
  Branded,
  CanonicalJsonValue,
  ContinuityEpochId,
  InstallationId,
  InstanceId,
  Instant,
  NamespacedId,
  ProductGenerationId,
  RetryClass,
  UuidV7Id,
} from "@heptalogos/foundation-contracts";
import {
  NAMESPACED_ID_PATTERN,
  SHA256_HEX_PATTERN,
  UUID_V7_PATTERN,
} from "@heptalogos/foundation-contracts";
import { lineageContextRefSchema } from "@heptalogos/execution-lineage";
import type { LineageContextRef } from "@heptalogos/execution-lineage";
import type { EvidenceRef } from "@heptalogos/evidence";
import type {
  ConfigurationActivation,
  ConfigurationDefinition,
  ConfigurationRevision,
  ConfigurationScopeRef,
} from "@heptalogos/configuration";
import {
  configurationActivateInputSchema,
  configurationRevisionCreateInputSchema,
} from "@heptalogos/configuration";
import type {
  AIRuntimeReadiness,
  ModelCapability,
  ModelBinding,
  ModelProfile,
  GatewayProfile,
} from "@heptalogos/ai-runtime";
import {
  modelBindingSetInputSchema,
  modelProfileSetInputSchema,
  gatewayProfileSetInputSchema,
} from "@heptalogos/ai-runtime";
import type { NetworkAccessDiagnostics } from "@heptalogos/network-access";
import type { SecretMetadata } from "@heptalogos/secret";
import {
  secretReplaceInputSchema,
  secretRevokeInputSchema,
  secretSetInputSchema,
} from "@heptalogos/secret";
import { Type } from "@heptalogos/schema-runtime/typebox";

/** Identifies the single current Administrator. */
export type AdministratorId = UuidV7Id<"AdministratorId">;
/** Identifies a first-administrator claim. */
export type FirstAdministratorClaimId = UuidV7Id<"FirstAdministratorClaimId">;
/** Identifies a server-side Management session. */
export type ServerSessionId = UuidV7Id<"ServerSessionId">;
/** Identifies an opaque SHA-256 digest stored or carried by Management. */
export type ManagementDigest = Branded<string, "ManagementDigest">;
/** Stable semantic identifier for a Management action contract. */
export type SystemActionId = NamespacedId<"SystemActionId">;
/** Identifies one generated side-effect-free System change plan. */
export type SystemChangePlanId = UuidV7Id<"SystemChangePlanId">;
/** Identifies a Product semantic owner affected by a plan. */
export type ProductSemanticId = NamespacedId<"ProductSemanticId">;

/** The version of the current Management wire contract. */
export const MANAGEMENT_CONTRACT_VERSION = "management.v1" as const;
/** The fixed API base path exposed by the current Host. */
export const MANAGEMENT_API_BASE_PATH = "/management/v1" as const;
/** The public well-known Management discovery path. */
export const MANAGEMENT_DISCOVERY_PATH = "/.well-known/heptalogos-management" as const;
/** The bounded first-claim lifetime in milliseconds. */
export const FIRST_CLAIM_LIFETIME_MS = 30 * 60 * 1_000;
/** The default server-side session lifetime in milliseconds. */
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

/** Describes the exact client/server contract range accepted by Management. */
export interface ContractRange {
  readonly kind: "exact";
  readonly version: typeof MANAGEMENT_CONTRACT_VERSION;
}
/** Describes the current Management contract and installation generation. */
export interface CompatibilityDescriptor {
  readonly schemaVersion: 1;
  readonly instanceId: InstanceId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly productGeneration: ProductGenerationId;
  readonly coreContractVersion: typeof MANAGEMENT_CONTRACT_VERSION;
  readonly supportedClientContractRange: ContractRange;
  readonly problemSchemaVersion: 1;
  readonly systemActionCatalogRevision?: number;
}
/** Public discovery response for a live Management endpoint. */
export interface ManagementDiscovery {
  readonly schemaVersion: 1;
  readonly installationId: InstallationId;
  readonly compatibility: CompatibilityDescriptor;
  readonly apiBasePath: typeof MANAGEMENT_API_BASE_PATH;
}

/** Identifies one canonical resource projection. */
export interface ResourceRef {
  readonly schemaVersion: 1;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly resourceRevision?: number;
}
/** Common machine-consumable envelope for current Management reads. */
export interface ReadModelEnvelope<T> {
  readonly schemaVersion: 1;
  readonly contractVersion: typeof MANAGEMENT_CONTRACT_VERSION;
  readonly resource: ResourceRef;
  readonly observedAt: Instant;
  readonly productGeneration: ProductGenerationId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly data: T;
  readonly lineageContextRef?: LineageContextRef;
}

/** Stable reference to one current JSON Schema contract. */
export interface JsonSchemaRef {
  readonly schemaVersion: 1;
  readonly schemaId: string;
}
/** Binds a planned action to an observed target state. */
export interface TargetPrecondition {
  readonly schemaVersion: 1;
  readonly resource: ResourceRef;
  readonly expectedRevision?: number;
  readonly expectedDigest?: ManagementDigest;
}
/** Describes one versioned semantic System action. */
export interface SystemActionDefinition {
  readonly schemaVersion: 1;
  readonly actionId: SystemActionId;
  readonly actionVersion: number;
  readonly inputSchema: JsonSchemaRef;
  readonly outputSchema: JsonSchemaRef;
  readonly targetKind: string;
  readonly riskClass: "READ_ONLY" | "LOW" | "MATERIAL";
  readonly applyMode: "IMMEDIATE" | "RECONCILE";
}
/** Side-effect-free plan that must be confirmed exactly before execution. */
export interface SystemChangePlan {
  readonly schemaVersion: 1;
  readonly planId: SystemChangePlanId;
  readonly actionId: SystemActionId;
  readonly actionVersion: number;
  readonly normalizedInputDigest: ManagementDigest;
  readonly targetPreconditions: readonly TargetPrecondition[];
  readonly affectedSemanticOwners: readonly ProductSemanticId[];
  readonly configurationReadinessSubjectImpact: CanonicalJsonValue;
  readonly restartReconcileImpact: CanonicalJsonValue;
  readonly riskClass: SystemActionDefinition["riskClass"];
  readonly planDigest: ManagementDigest;
  readonly createdAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}
/** Result of executing one exactly confirmed System change plan. */
export interface SystemActionExecuteResult<T> {
  readonly schemaVersion: 1;
  readonly actionId: SystemActionId;
  readonly planDigest: ManagementDigest;
  readonly result: T;
  readonly postconditionsVerified: boolean;
  readonly evidenceRefs: readonly EvidenceRef[];
}

/** The only current Management mutation action identifiers. */
export type ProductSystemActionId =
  | "configuration.revision.create"
  | "configuration.activate"
  | "secret.set"
  | "secret.replace"
  | "secret.revoke"
  | "gateway-profile.set"
  | "model-profile.set"
  | "model-binding.set"
  | "subject.start"
  | "subject.stop";

/** The normalized configuration revision action input. */
export interface ConfigurationRevisionCreateActionInput {
  readonly definitionId: string;
  readonly scopeRef: ConfigurationScopeRef;
  readonly value: CanonicalJsonValue;
}
/** The normalized configuration activation action input. */
interface ConfigurationActivateActionInput {
  readonly revisionId: string;
  readonly expectedActiveRevisionId?: string;
}
/** The protected Secret set action input. */
interface SecretSetActionInput {
  readonly purpose: string;
  readonly scopeRef?: {
    readonly schemaVersion: 1;
    readonly resourceKind: string;
    readonly resourceId: string;
  };
  readonly material: string;
}
/** The protected Secret replacement action input. */
interface SecretReplaceActionInput {
  readonly secretRef: string;
  readonly material: string;
}
/** Input to revoke one SecretRef without exposing its material. */
interface SecretRevokeActionInput {
  readonly secretRef: string;
}
/** Input to set one configured GatewayProfile. */
interface GatewayProfileSetActionInput {
  readonly gatewayProfileId?: string;
  readonly baseUrl: string;
  readonly apiTokenSecretRef?: {
    readonly schemaVersion: 1;
    readonly secretId: string;
  };
  readonly enabled: boolean;
}
/** Input to set one model profile consumed by AIRuntime. */
interface ModelProfileSetActionInput {
  readonly modelProfileId?: string;
  readonly gatewayProfileId: string;
  readonly modelIdentifier: string;
  readonly protocol: "openai-chat" | "openai-responses";
  readonly consumedCapabilities: readonly ModelCapability[];
}
/** The exact model binding action input. */
interface ModelBindingSetActionInput {
  readonly role: "subject.primary" | "subject.expression";
  readonly modelProfileId: string;
}

/** Input to the current Subject desired-state actions. */
export interface SubjectStateActionInput {
  readonly subjectId: string;
  readonly expectedAuthorityRevision: number;
}

/** A typed action request accepted by the current Management slice. */
export type SystemActionRequest =
  | {
      readonly actionId: "configuration.revision.create";
      readonly input: ConfigurationRevisionCreateActionInput;
    }
  | {
      readonly actionId: "configuration.activate";
      readonly input: ConfigurationActivateActionInput;
    }
  | { readonly actionId: "secret.set"; readonly input: SecretSetActionInput }
  | {
      readonly actionId: "secret.replace";
      readonly input: SecretReplaceActionInput;
    }
  | {
      readonly actionId: "secret.revoke";
      readonly input: SecretRevokeActionInput;
    }
  | {
      readonly actionId: "gateway-profile.set";
      readonly input: GatewayProfileSetActionInput;
    }
  | {
      readonly actionId: "model-profile.set";
      readonly input: ModelProfileSetActionInput;
    }
  | {
      readonly actionId: "model-binding.set";
      readonly input: ModelBindingSetActionInput;
    }
  | { readonly actionId: "subject.start"; readonly input: SubjectStateActionInput }
  | { readonly actionId: "subject.stop"; readonly input: SubjectStateActionInput };

/** The exact request used to confirm and execute a previously planned action. */
export interface SystemActionExecuteRequest {
  readonly plan: SystemChangePlan;
  readonly action: SystemActionRequest;
}

/** Current Subject status shape projected by Management without owning Subject state. */
export interface SubjectStatusProjection {
  readonly schemaVersion: 1;
  readonly subjectId: string;
  readonly desiredState: "STOPPED" | "RUNNING";
  readonly actualState:
    | "STOPPED"
    | "STARTING"
    | "READY"
    | "ACTIVE"
    | "DEGRADED"
    | "BLOCKED"
    | "STOPPING"
    | "FAILED";
  readonly authorityRevision: number;
  readonly blockers: readonly {
    readonly code: string;
    readonly detail: string;
  }[];
}

/** Current redacted Product prerequisite state exposed by Management reads. */
export interface ProductStateData {
  readonly schemaVersion: 1;
  readonly configuration: {
    readonly definitions: readonly ConfigurationDefinition[];
    readonly revisions: readonly ConfigurationRevision[];
    readonly activations: readonly ConfigurationActivation[];
  };
  readonly secrets: readonly SecretMetadata[];
  readonly gatewayProfiles: readonly GatewayProfile[];
  readonly modelProfiles: readonly ModelProfile[];
  readonly modelBindings: readonly ModelBinding[];
  readonly networkAccess: NetworkAccessDiagnostics;
  readonly aiReadiness: AIRuntimeReadiness;
  readonly subject: SubjectStatusProjection;
}
/** Current Product prerequisite read envelope. */
export type ProductStateReadModel = ReadModelEnvelope<ProductStateData>;

/** The current Product action catalog revision. */
export const SYSTEM_ACTION_CATALOG_REVISION = 4 as const;

/** The current Management action catalog, without a generic operation store. */
export const currentSystemActionCatalog: readonly SystemActionDefinition[] =
  Object.freeze([
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "configuration.revision.create" as SystemActionId,
      actionVersion: 1,
      inputSchema: {
        schemaVersion: 1 as const,
        schemaId: "configuration.revision.create.input",
      },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "configuration-scope",
      riskClass: "LOW" as const,
      applyMode: "IMMEDIATE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "configuration.activate" as SystemActionId,
      actionVersion: 1,
      inputSchema: {
        schemaVersion: 1 as const,
        schemaId: "configuration.activate.input",
      },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "configuration-scope",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "secret.set" as SystemActionId,
      actionVersion: 1,
      inputSchema: { schemaVersion: 1 as const, schemaId: "secret.set.input" },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "secret",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "secret.replace" as SystemActionId,
      actionVersion: 1,
      inputSchema: { schemaVersion: 1 as const, schemaId: "secret.replace.input" },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "secret",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "secret.revoke" as SystemActionId,
      actionVersion: 1,
      inputSchema: { schemaVersion: 1 as const, schemaId: "secret.revoke.input" },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "secret",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "gateway-profile.set" as SystemActionId,
      actionVersion: 1,
      inputSchema: {
        schemaVersion: 1 as const,
        schemaId: "gateway-profile.set.input",
      },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "gateway-profile",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "model-profile.set" as SystemActionId,
      actionVersion: 1,
      inputSchema: { schemaVersion: 1 as const, schemaId: "model-profile.set.input" },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "model-profile",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "model-binding.set" as SystemActionId,
      actionVersion: 1,
      inputSchema: { schemaVersion: 1 as const, schemaId: "model-binding.set.input" },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "model-binding",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "subject.start" as SystemActionId,
      actionVersion: 1,
      inputSchema: { schemaVersion: 1 as const, schemaId: "subject.start.input" },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "subject",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
    Object.freeze({
      schemaVersion: 1 as const,
      actionId: "subject.stop" as SystemActionId,
      actionVersion: 1,
      inputSchema: { schemaVersion: 1 as const, schemaId: "subject.stop.input" },
      outputSchema: {
        schemaVersion: 1 as const,
        schemaId: "management.system-action.result",
      },
      targetKind: "subject",
      riskClass: "MATERIAL" as const,
      applyMode: "RECONCILE" as const,
    }),
  ]);

/** Describes a public Management Problem response. */
export interface ManagementProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string;
  readonly problemCode: string;
  readonly category: string;
  readonly retryClass: RetryClass;
  readonly schemaVersion: 1;
}
/** Request body for first-administrator claim consumption. */
export interface ClaimRequest {
  readonly claimId: string;
  readonly claimSecret: string;
  readonly password: string;
}
/** Successful first-administrator claim response. */
export interface ClaimResponse {
  readonly schemaVersion: 1;
  readonly administratorId: AdministratorId;
}
/** Short-lived plaintext claim material published only by the Host. */
export interface FirstClaimMaterial {
  readonly claimId: FirstAdministratorClaimId;
  readonly claimSecret: string;
  readonly expiresAt: Instant;
}
/** Request body for Administrator login. */
export interface LoginRequest {
  readonly password: string;
}
/** Successful login response with token plaintext returned once. */
export interface LoginResponse {
  readonly schemaVersion: 1;
  readonly sessionToken: string;
  readonly expiresAt: Instant;
}

/** Administrator bootstrap states projected by SystemStatus. */
export type AdministratorBootstrapState = "UNCLAIMED" | "CLAIM_READY" | "CLAIMED";
/** Current Host states accepted by Management read models. */
export type ManagementHostState = "ACTIVE" | "FENCED" | "CLOSING" | "CLOSED";
/** Current Management HTTP lifecycle states. */
export type ManagementHttpState = "STARTING" | "LISTENING" | "CLOSING" | "CLOSED";
/** Runtime operating modes visible through Management. */
export type RuntimeOperatingMode =
  "NORMAL" | "SAFE" | "MAINTENANCE" | "EMERGENCY_READ_ONLY";
/** Runtime semantic roles visible through Management. */
export type RuntimeSystemRole =
  "kernel" | "system-service" | "domain-engine" | "feature" | "driver" | "provider";
/** Runtime actual states visible through Management. */
export type RuntimeSystemActualState =
  "STOPPED" | "BLOCKED" | "STARTING" | "RUNNING" | "QUIESCING" | "FAILED";

/** Read-only readiness data for current Product Host dependencies. */
export interface ReadinessData {
  readonly schemaVersion: 1;
  readonly hostActive: boolean;
  readonly persistenceUsable: boolean;
  readonly runtimeKernelActive: boolean;
  readonly managementServiceRunning: boolean;
  readonly httpListening: boolean;
  readonly endpointDescriptorPublished: boolean;
  readonly administratorBootstrapCoherent: boolean;
  readonly state: "READY" | "NOT_READY";
}
/** Current readiness envelope. */
export type Readiness = ReadModelEnvelope<ReadinessData>;
/** Safe Host identity/state data. */
export interface HostReadModelData {
  readonly schemaVersion: 1;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly hostState: ManagementHostState;
  readonly managementHttpState: ManagementHttpState;
}
/** Current Host read envelope. */
export type HostReadModel = ReadModelEnvelope<HostReadModelData>;

/** Read-only Service/Capability binding projection. */
export interface RuntimeBindingSnapshot {
  readonly id: string;
  readonly providerId: string;
}
/** Read-only Service requirement projection. */
export interface RuntimeRequirementSnapshot {
  readonly serviceId: string;
  readonly contractVersion: string;
}
/** Read-only Service provision projection. */
export interface RuntimeProvisionSnapshot {
  readonly serviceId: string;
  readonly providerId: string;
  readonly contractVersion: string;
}
/** Read-only Capability requirement projection. */
export interface RuntimeCapabilityRequirementSnapshot {
  readonly capabilityId: string;
  readonly contractVersion: string;
  readonly required: boolean;
}
/** Read-only Capability provision projection. */
export interface RuntimeCapabilityProvisionSnapshot {
  readonly capabilityId: string;
  readonly providerId: string;
  readonly contractVersion: string;
  readonly priority: number;
}
/** Safe read-only MicroSystem projection used by RuntimeGraph. */
export interface RuntimeSystemSnapshot {
  readonly microSystemId: string;
  readonly role: RuntimeSystemRole;
  readonly actualState: RuntimeSystemActualState;
  readonly generation: {
    readonly productGenerationId: ProductGenerationId;
    readonly packageGenerationId?: string;
  };
  readonly serviceRequirements: readonly RuntimeRequirementSnapshot[];
  readonly serviceProvisions: readonly RuntimeProvisionSnapshot[];
  readonly capabilityRequirements: readonly RuntimeCapabilityRequirementSnapshot[];
  readonly capabilityProvisions: readonly RuntimeCapabilityProvisionSnapshot[];
}
/** Minimal runtime introspection source supplied by Product Host. */
export interface RuntimeIntrospectionSnapshot {
  readonly operatingMode: RuntimeOperatingMode;
  readonly desiredRevision: number;
  readonly systems: readonly RuntimeSystemSnapshot[];
  readonly selectedServiceBindings: readonly RuntimeBindingSnapshot[];
  readonly selectedCapabilityBindings: readonly RuntimeBindingSnapshot[];
}
/** One read-only hard Service edge in RuntimeGraph. */
export interface RuntimeGraphEdge {
  readonly providerMicroSystemId: string;
  readonly consumerMicroSystemId: string;
  readonly serviceId: string;
  readonly providerId: string;
  readonly contractVersion: string;
}
/** Runtime graph data derived from one RuntimeKernel snapshot. */
export interface RuntimeGraphReadModelData {
  readonly schemaVersion: 1;
  readonly operatingMode: RuntimeOperatingMode;
  readonly desiredRevision: number;
  readonly systems: readonly RuntimeSystemSnapshot[];
  readonly edges: readonly RuntimeGraphEdge[];
}
/** Current Runtime graph envelope. */
export type RuntimeGraphReadModel = ReadModelEnvelope<RuntimeGraphReadModelData>;
/** One capability and its currently visible providers. */
export interface RuntimeCapabilityGraphEntry {
  readonly capabilityId: string;
  readonly providers: readonly RuntimeCapabilityProvisionSnapshot[];
}
/** Capability graph data derived from one RuntimeKernel snapshot. */
export interface CapabilityGraphReadModelData {
  readonly schemaVersion: 1;
  readonly capabilities: readonly RuntimeCapabilityGraphEntry[];
  readonly selectedBindings: readonly RuntimeBindingSnapshot[];
}
/** Current Capability graph envelope. */
export type CapabilityGraphReadModel = ReadModelEnvelope<CapabilityGraphReadModelData>;
/** Aggregate system status data. */
export interface SystemStatusData {
  readonly schemaVersion: 1;
  readonly hostState: ManagementHostState;
  readonly managementState: ManagementHttpState;
  readonly administratorBootstrap: AdministratorBootstrapState;
  readonly readiness: ReadinessData;
}
/** Current aggregate System status envelope. */
export type SystemStatus = ReadModelEnvelope<SystemStatusData>;

/** Internal current Administrator verifier row. */
export interface AdministratorVerifier {
  readonly administratorId: AdministratorId;
  readonly authEpoch: number;
  readonly passwordAlgorithm: "argon2id";
  readonly passwordSalt: Uint8Array;
  readonly passwordNonce: Uint8Array;
  readonly passwordVerifier: Uint8Array;
  readonly passwordMemoryCost: number;
  readonly passwordTimeCost: number;
  readonly passwordParallelism: number;
  readonly passwordNormalizationId: "NFKC-v1";
}
/** Internal current claim row. */
export interface FirstAdministratorClaim {
  readonly claimId: FirstAdministratorClaimId;
  readonly secretDigest: ManagementDigest;
  readonly createdAt: Instant;
  readonly expiresAt: Instant;
  readonly consumedAt?: Instant;
}
/** Internal current session row. */
export interface ServerSession {
  readonly sessionId: ServerSessionId;
  readonly tokenDigest: ManagementDigest;
  readonly administratorId: AdministratorId;
  readonly authEpoch: number;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
  readonly revokedAt?: Instant;
}

const retryClassSchema = Type.Union([
  Type.Literal("never"),
  Type.Literal("immediate"),
  Type.Literal("backoff"),
  Type.Literal("after-change"),
  Type.Literal("manual"),
]);
const runtimeOperatingModeSchema = Type.Union([
  Type.Literal("NORMAL"),
  Type.Literal("SAFE"),
  Type.Literal("MAINTENANCE"),
  Type.Literal("EMERGENCY_READ_ONLY"),
]);
const runtimeSystemRoleSchema = Type.Union([
  Type.Literal("kernel"),
  Type.Literal("system-service"),
  Type.Literal("domain-engine"),
  Type.Literal("feature"),
  Type.Literal("driver"),
  Type.Literal("provider"),
]);
const runtimeSystemActualStateSchema = Type.Union([
  Type.Literal("STOPPED"),
  Type.Literal("BLOCKED"),
  Type.Literal("STARTING"),
  Type.Literal("RUNNING"),
  Type.Literal("QUIESCING"),
  Type.Literal("FAILED"),
]);
const canonicalJsonSchema = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Type.Unknown()),
  Type.Record(Type.String(), Type.Unknown()),
]);

/** Canonical wire schema for a resource projection reference. */
export const resourceRefSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  resourceKind: Type.String({ minLength: 1 }),
  resourceId: Type.String({ minLength: 1 }),
  resourceRevision: Type.Optional(Type.Integer({ minimum: 0 })),
});
function readModelEnvelopeSchema(data: ReturnType<typeof Type.Object>) {
  return Type.Object({
    schemaVersion: Type.Literal(1),
    contractVersion: Type.Literal(MANAGEMENT_CONTRACT_VERSION),
    resource: resourceRefSchema,
    observedAt: Type.String(),
    productGeneration: Type.String({ pattern: SHA256_HEX_PATTERN }),
    continuityEpochId: Type.String({ pattern: UUID_V7_PATTERN }),
    data,
    lineageContextRef: Type.Optional(lineageContextRefSchema),
  });
}

const jsonSchemaRefSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  schemaId: Type.String({ minLength: 1 }),
});
const riskClassSchema = Type.Union([
  Type.Literal("READ_ONLY"),
  Type.Literal("LOW"),
  Type.Literal("MATERIAL"),
]);
/** Canonical wire schema for a System action definition. */
export const systemActionDefinitionSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  actionId: Type.String({ pattern: NAMESPACED_ID_PATTERN }),
  actionVersion: Type.Integer({ minimum: 1 }),
  inputSchema: jsonSchemaRefSchema,
  outputSchema: jsonSchemaRefSchema,
  targetKind: Type.String({ minLength: 1 }),
  riskClass: riskClassSchema,
  applyMode: Type.Union([Type.Literal("IMMEDIATE"), Type.Literal("RECONCILE")]),
});
/** Canonical wire schema for a side-effect-free System change plan. */
export const systemChangePlanSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  planId: Type.String({ pattern: UUID_V7_PATTERN }),
  actionId: Type.String({ pattern: NAMESPACED_ID_PATTERN }),
  actionVersion: Type.Integer({ minimum: 1 }),
  normalizedInputDigest: Type.String({ pattern: SHA256_HEX_PATTERN }),
  targetPreconditions: Type.Array(
    Type.Object({
      schemaVersion: Type.Literal(1),
      resource: resourceRefSchema,
      expectedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
      expectedDigest: Type.Optional(Type.String({ pattern: SHA256_HEX_PATTERN })),
    }),
  ),
  affectedSemanticOwners: Type.Array(Type.String({ pattern: NAMESPACED_ID_PATTERN })),
  configurationReadinessSubjectImpact: canonicalJsonSchema,
  restartReconcileImpact: canonicalJsonSchema,
  riskClass: riskClassSchema,
  planDigest: Type.String({ pattern: SHA256_HEX_PATTERN }),
  createdAt: Type.String(),
  lineageContextRef: lineageContextRefSchema,
});
/** Canonical wire schema for an executed System action result. */
export const systemActionExecuteResultSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  actionId: Type.String({ pattern: NAMESPACED_ID_PATTERN }),
  planDigest: Type.String({ pattern: SHA256_HEX_PATTERN }),
  result: canonicalJsonSchema,
  postconditionsVerified: Type.Boolean(),
  evidenceRefs: Type.Array(
    Type.Object({
      schemaVersion: Type.Literal(1),
      evidenceId: Type.String({ pattern: UUID_V7_PATTERN }),
    }),
  ),
});

/** Canonical wire schema for one typed Product action request. */
export const systemActionRequestSchema = Type.Union([
  Type.Object(
    {
      actionId: Type.Literal("configuration.revision.create"),
      input: configurationRevisionCreateInputSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      actionId: Type.Literal("configuration.activate"),
      input: configurationActivateInputSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { actionId: Type.Literal("secret.set"), input: secretSetInputSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { actionId: Type.Literal("secret.replace"), input: secretReplaceInputSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { actionId: Type.Literal("secret.revoke"), input: secretRevokeInputSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      actionId: Type.Literal("gateway-profile.set"),
      input: gatewayProfileSetInputSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      actionId: Type.Literal("model-profile.set"),
      input: modelProfileSetInputSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      actionId: Type.Literal("model-binding.set"),
      input: modelBindingSetInputSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      actionId: Type.Literal("subject.start"),
      input: Type.Object(
        {
          subjectId: Type.String({ pattern: UUID_V7_PATTERN }),
          expectedAuthorityRevision: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  // Intentional duplication: start and stop remain explicit wire discriminants
  // so each lifecycle operation's schema is visible in the public contract.
  /* jscpd:ignore-start */
  Type.Object(
    {
      actionId: Type.Literal("subject.stop"),
      input: Type.Object(
        {
          subjectId: Type.String({ pattern: UUID_V7_PATTERN }),
          expectedAuthorityRevision: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  /* jscpd:ignore-end */
]);
/** Canonical wire schema for exact action-plan confirmation and execution. */
export const systemActionExecuteRequestSchema = Type.Object(
  {
    plan: systemChangePlanSchema,
    action: systemActionRequestSchema,
  },
  { additionalProperties: false },
);

/** Canonical wire schema for the redacted Product prerequisite projection. */
export const productStateSchema = readModelEnvelopeSchema(
  Type.Object(
    {
      schemaVersion: Type.Literal(1),
      configuration: Type.Object(
        {
          definitions: Type.Array(Type.Unknown()),
          revisions: Type.Array(Type.Unknown()),
          activations: Type.Array(Type.Unknown()),
        },
        { additionalProperties: false },
      ),
      secrets: Type.Array(Type.Unknown()),
      gatewayProfiles: Type.Array(Type.Unknown()),
      modelProfiles: Type.Array(Type.Unknown()),
      modelBindings: Type.Array(Type.Unknown()),
      networkAccess: Type.Unknown(),
      aiReadiness: Type.Unknown(),
      subject: Type.Object(
        {
          schemaVersion: Type.Literal(1),
          subjectId: Type.String({ pattern: UUID_V7_PATTERN }),
          desiredState: Type.Union([Type.Literal("STOPPED"), Type.Literal("RUNNING")]),
          actualState: Type.String({ minLength: 1 }),
          authorityRevision: Type.Integer({ minimum: 1 }),
          blockers: Type.Array(
            Type.Object(
              {
                code: Type.String({ minLength: 1 }),
                detail: Type.String({ minLength: 1 }),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
);

/** Canonical wire schema for a Problem Details response. */
export const managementProblemSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  detail: Type.String(),
  instance: Type.Optional(Type.String()),
  problemCode: Type.String(),
  category: Type.String(),
  retryClass: retryClassSchema,
  schemaVersion: Type.Literal(1),
});
/** Canonical wire schema for Management discovery. */
export const managementDiscoverySchema = Type.Object({
  schemaVersion: Type.Literal(1),
  installationId: Type.String(),
  compatibility: Type.Object({
    schemaVersion: Type.Literal(1),
    instanceId: Type.String(),
    continuityEpochId: Type.String(),
    productGeneration: Type.String(),
    coreContractVersion: Type.Literal(MANAGEMENT_CONTRACT_VERSION),
    supportedClientContractRange: Type.Object({
      kind: Type.Literal("exact"),
      version: Type.Literal(MANAGEMENT_CONTRACT_VERSION),
    }),
    problemSchemaVersion: Type.Literal(1),
    systemActionCatalogRevision: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  apiBasePath: Type.Literal(MANAGEMENT_API_BASE_PATH),
});
/** Canonical wire schema for the first-claim request. */
export const claimRequestSchema = Type.Object({
  claimId: Type.String({ minLength: 1 }),
  claimSecret: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
});
/** Canonical wire schema for the first-claim response. */
export const claimResponseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  administratorId: Type.String(),
});
/** Canonical wire schema for login. */
export const loginRequestSchema = Type.Object({
  password: Type.String({ minLength: 1 }),
});
/** Canonical wire schema for a successful login. */
export const loginResponseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  sessionToken: Type.String({ minLength: 1 }),
  expiresAt: Type.String(),
});

/** Canonical schema for a runtime binding snapshot. */
export const runtimeBindingSnapshotSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  providerId: Type.String({ minLength: 1 }),
});
/** Canonical schema for a runtime Service requirement. */
export const runtimeRequirementSnapshotSchema = Type.Object({
  serviceId: Type.String({ minLength: 1 }),
  contractVersion: Type.String({ minLength: 1 }),
});
/** Canonical schema for a runtime Service provision. */
export const runtimeProvisionSnapshotSchema = Type.Object({
  serviceId: Type.String({ minLength: 1 }),
  providerId: Type.String({ minLength: 1 }),
  contractVersion: Type.String({ minLength: 1 }),
});
/** Canonical schema for a runtime Capability requirement. */
export const runtimeCapabilityRequirementSnapshotSchema = Type.Object({
  capabilityId: Type.String({ minLength: 1 }),
  contractVersion: Type.String({ minLength: 1 }),
  required: Type.Boolean(),
});
/** Canonical schema for a runtime Capability provision. */
export const runtimeCapabilityProvisionSnapshotSchema = Type.Object({
  capabilityId: Type.String({ minLength: 1 }),
  providerId: Type.String({ minLength: 1 }),
  contractVersion: Type.String({ minLength: 1 }),
  priority: Type.Number(),
});
/** Canonical schema for a Runtime MicroSystem snapshot. */
export const runtimeSystemSnapshotSchema = Type.Object({
  microSystemId: Type.String({ minLength: 1 }),
  role: runtimeSystemRoleSchema,
  actualState: runtimeSystemActualStateSchema,
  generation: Type.Object({
    productGenerationId: Type.String({ pattern: SHA256_HEX_PATTERN }),
    packageGenerationId: Type.Optional(Type.String({ pattern: SHA256_HEX_PATTERN })),
  }),
  serviceRequirements: Type.Array(runtimeRequirementSnapshotSchema),
  serviceProvisions: Type.Array(runtimeProvisionSnapshotSchema),
  capabilityRequirements: Type.Array(runtimeCapabilityRequirementSnapshotSchema),
  capabilityProvisions: Type.Array(runtimeCapabilityProvisionSnapshotSchema),
});
/** Canonical schema for one RuntimeGraph Service edge. */
export const runtimeGraphEdgeSchema = Type.Object({
  providerMicroSystemId: Type.String({ minLength: 1 }),
  consumerMicroSystemId: Type.String({ minLength: 1 }),
  serviceId: Type.String({ minLength: 1 }),
  providerId: Type.String({ minLength: 1 }),
  contractVersion: Type.String({ minLength: 1 }),
});
/** Canonical schema for one CapabilityGraph entry. */
export const runtimeCapabilityGraphEntrySchema = Type.Object({
  capabilityId: Type.String({ minLength: 1 }),
  providers: Type.Array(runtimeCapabilityProvisionSnapshotSchema),
});

const readinessDataSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  hostActive: Type.Boolean(),
  persistenceUsable: Type.Boolean(),
  runtimeKernelActive: Type.Boolean(),
  managementServiceRunning: Type.Boolean(),
  httpListening: Type.Boolean(),
  endpointDescriptorPublished: Type.Boolean(),
  administratorBootstrapCoherent: Type.Boolean(),
  state: Type.Union([Type.Literal("READY"), Type.Literal("NOT_READY")]),
});
/** Canonical wire schema for Product Host readiness. */
export const readinessSchema = readModelEnvelopeSchema(readinessDataSchema);
/** Canonical wire schema for SystemStatus. */
export const systemStatusSchema = readModelEnvelopeSchema(
  Type.Object({
    schemaVersion: Type.Literal(1),
    hostState: Type.Union([
      Type.Literal("ACTIVE"),
      Type.Literal("FENCED"),
      Type.Literal("CLOSING"),
      Type.Literal("CLOSED"),
    ]),
    managementState: Type.Union([
      Type.Literal("STARTING"),
      Type.Literal("LISTENING"),
      Type.Literal("CLOSING"),
      Type.Literal("CLOSED"),
    ]),
    administratorBootstrap: Type.Union([
      Type.Literal("UNCLAIMED"),
      Type.Literal("CLAIM_READY"),
      Type.Literal("CLAIMED"),
    ]),
    readiness: readinessDataSchema,
  }),
);
/** Canonical wire schema for the safe Host read model. */
export const hostReadModelSchema = readModelEnvelopeSchema(
  Type.Object({
    schemaVersion: Type.Literal(1),
    installationId: Type.String({ pattern: UUID_V7_PATTERN }),
    instanceId: Type.String({ pattern: UUID_V7_PATTERN }),
    bootId: Type.String({ pattern: UUID_V7_PATTERN }),
    hostState: Type.Union([
      Type.Literal("ACTIVE"),
      Type.Literal("FENCED"),
      Type.Literal("CLOSING"),
      Type.Literal("CLOSED"),
    ]),
    managementHttpState: Type.Union([
      Type.Literal("STARTING"),
      Type.Literal("LISTENING"),
      Type.Literal("CLOSING"),
      Type.Literal("CLOSED"),
    ]),
  }),
);
/** Canonical wire schema for RuntimeGraph. */
export const runtimeGraphSchema = readModelEnvelopeSchema(
  Type.Object({
    schemaVersion: Type.Literal(1),
    operatingMode: runtimeOperatingModeSchema,
    desiredRevision: Type.Integer({ minimum: 0 }),
    systems: Type.Array(runtimeSystemSnapshotSchema),
    edges: Type.Array(runtimeGraphEdgeSchema),
  }),
);
/** Canonical wire schema for CapabilityGraph. */
export const capabilityGraphSchema = readModelEnvelopeSchema(
  Type.Object({
    schemaVersion: Type.Literal(1),
    capabilities: Type.Array(runtimeCapabilityGraphEntrySchema),
    selectedBindings: Type.Array(runtimeBindingSnapshotSchema),
  }),
);
