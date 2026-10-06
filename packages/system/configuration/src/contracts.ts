// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the current managed-revision Configuration contract and its narrow
 * provider-transport consumer shape.
 * @module contracts
 */

import type {
  Branded,
  CanonicalJsonValue,
  ContentDigest,
  Instant,
  UuidV7Id,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContextRuntime,
  LineageContextRef,
} from "@heptalogos/execution-lineage";
import type { EvidenceRef, EvidenceService } from "@heptalogos/evidence";
import type {
  PersistenceMutationTransactionContext,
  PersistenceService,
} from "@heptalogos/persistence";
import type { TimeService } from "@heptalogos/time-service";
import { Type } from "@heptalogos/schema-runtime/typebox";

/** Identifies one code-owned ConfigurationDefinition. */
export type ConfigurationDefinitionId = Branded<string, "ConfigurationDefinitionId">;
/** Identifies one immutable ConfigurationRevision. */
export type ConfigurationRevisionId = UuidV7Id<"ConfigurationRevisionId">;
/** Identifies one effective ConfigurationActivation. */
type ConfigurationActivationId = UuidV7Id<"ConfigurationActivationId">;

/** Identifies the Product resource whose configuration is being managed. */
export interface ConfigurationScopeRef {
  readonly schemaVersion: 1;
  readonly resourceKind: string;
  readonly resourceId: string;
}

/** Defines one code-owned typed Configuration namespace. */
export interface ConfigurationDefinition {
  readonly schemaVersion: 1;
  readonly definitionId: ConfigurationDefinitionId;
  readonly owner: string;
  readonly version: number;
  readonly scopeKind: "INSTALLATION" | "SUBJECT" | "RESOURCE";
  readonly valueSchema: CanonicalJsonValue;
  readonly classification:
    "PRODUCT_INVARIANT" | "INSTALLATION_CONFIG" | "SUBJECT_CONFIG" | "RESOURCE_CONFIG";
  readonly visibility: "NORMAL" | "ADVANCED" | "EXPERT" | "INTERNAL" | "HIDDEN";
  readonly manageability:
    "EDITABLE" | "READ_ONLY" | "SYSTEM_MANAGED" | "PRODUCT_LOCKED";
  readonly activation:
    | "LIVE"
    | "RELOAD_COMPONENT"
    | "RESTART_COMPONENT"
    | "RESTART_SUBJECT"
    | "RESTART_HOST"
    | "MAINTENANCE"
    | "NEXT_BOOT"
    | "IMMUTABLE_AFTER_INIT";
  readonly sensitivity: "PUBLIC" | "INTERNAL" | "SENSITIVE";
  readonly defaultAuthority:
    | "PRODUCT_DEFAULT"
    | "PLATFORM_DEFAULT"
    | "PROVIDER_DEFAULT"
    | "AUTO_DETECTED"
    | "NO_DEFAULT_REQUIRED";
  readonly consumerRefs: readonly string[];
}

/** A committed immutable managed Configuration revision. */
export interface ConfigurationRevision {
  readonly schemaVersion: 1;
  readonly revisionId: ConfigurationRevisionId;
  readonly definitionId: ConfigurationDefinitionId;
  readonly definitionVersion: number;
  readonly scopeRef: ConfigurationScopeRef;
  readonly value: CanonicalJsonValue;
  readonly source: "MANAGED_REVISION";
  readonly status: "COMMITTED";
  readonly valueDigest: ContentDigest<"ConfigurationValueDigest">;
  readonly createdAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}

/** The currently effective revision for one configuration scope. */
export interface ConfigurationActivation {
  readonly schemaVersion: 1;
  readonly activationId: ConfigurationActivationId;
  readonly definitionId: ConfigurationDefinitionId;
  readonly scopeRef: ConfigurationScopeRef;
  readonly activeRevisionId: ConfigurationRevisionId;
  readonly previousRevisionId?: ConfigurationRevisionId;
  readonly impact: ConfigurationDefinition["activation"];
  readonly effectiveAt: Instant;
  readonly lineageContextRef: LineageContextRef;
  readonly evidenceRefs: readonly EvidenceRef[];
}

/** Input accepted by the Configuration owner after Management normalization. */
export interface CreateConfigurationRevisionInput {
  readonly definitionId: ConfigurationDefinitionId | string;
  readonly scopeRef: ConfigurationScopeRef;
  readonly value: CanonicalJsonValue;
}

/** Input accepted by the Configuration activation owner. */
export interface ActivateConfigurationInput {
  readonly revisionId: ConfigurationRevisionId | string;
  readonly expectedActiveRevisionId?: ConfigurationRevisionId | string;
}

/** Options binding Configuration to existing Foundation owners. */
export interface ConfigurationServiceOptions {
  /** Current Product composition's owner-provided definitions. */
  readonly definitions: readonly ConfigurationDefinition[];
  readonly persistence: PersistenceService;
  readonly time: TimeService;
  readonly execution: ExecutionContextRuntime;
  readonly evidence: EvidenceService;
}

/** Read-only contract consumed by other Product owners and Management. */
export interface ConfigurationService {
  /** Code-owned definitions available to the current Product slice. */
  readonly definitions: readonly ConfigurationDefinition[];
  /** Reads one definition by its stable identifier. */
  getDefinition(
    definitionId: ConfigurationDefinitionId | string,
  ): ConfigurationDefinition | undefined;
  /** Lists immutable managed revisions. */
  listRevisions(): Promise<readonly ConfigurationRevision[]>;
  /** Lists current and historical activation rows. */
  listActivations(): Promise<readonly ConfigurationActivation[]>;
  /** Reads one immutable revision. */
  getRevision(
    revisionId: ConfigurationRevisionId | string,
  ): Promise<ConfigurationRevision | undefined>;
  /** Reads the active revision for one scope. */
  getActivation(
    definitionId: ConfigurationDefinitionId | string,
    scopeRef: ConfigurationScopeRef,
  ): Promise<ConfigurationActivation | undefined>;
  /** Resolves the effective revision for one definition and scope. */
  getEffectiveRevision(
    definitionId: ConfigurationDefinitionId | string,
    scopeRef: ConfigurationScopeRef,
  ): Promise<ConfigurationRevision | undefined>;
  /** Revalidates one active revision inside a caller-owned mutation transaction. */
  assertActiveRevisionForCommit(
    transaction: PersistenceMutationTransactionContext,
    input: {
      readonly definitionId: ConfigurationDefinitionId | string;
      readonly scopeRef: ConfigurationScopeRef;
      readonly revisionId: ConfigurationRevisionId | string;
    },
  ): Promise<void>;
  /** Commits one immutable managed revision. */
  createRevision(
    input: CreateConfigurationRevisionInput,
  ): Promise<ConfigurationRevision>;
  /** Activates one revision with the owner-level CAS precondition. */
  activate(input: ActivateConfigurationInput): Promise<ConfigurationActivation>;
  /** Validates and returns a current definition value. */
  validateValue(
    definitionId: ConfigurationDefinitionId | string,
    value: CanonicalJsonValue,
  ): CanonicalJsonValue;
}

const scopeRefSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    resourceKind: Type.String({ minLength: 1, maxLength: 128 }),
    resourceId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

/** JSON Schema for the normalized revision-create action input. */
export const configurationRevisionCreateInputSchema = Type.Object(
  {
    definitionId: Type.String({ minLength: 1, maxLength: 256 }),
    scopeRef: scopeRefSchema,
    value: Type.Unknown(),
  },
  { additionalProperties: false },
);

/** JSON Schema for the normalized activation action input. */
export const configurationActivateInputSchema = Type.Object(
  {
    revisionId: Type.String({ minLength: 1 }),
    expectedActiveRevisionId: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

/** JSON Schema for the public configuration scope reference. */
export const configurationScopeRefSchema = scopeRefSchema;
