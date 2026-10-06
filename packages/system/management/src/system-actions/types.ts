// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internal SystemAction family contracts and shared canonical helpers.
 * @module system-actions/types
 */

import type { AIRuntimeService } from "@heptalogos/ai-runtime";
import type { ConfigurationService } from "@heptalogos/configuration";
import {
  digestCanonicalJson,
  parseUuidV7Id,
  snapshotCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { NetworkAccessService } from "@heptalogos/network-access";
import type { SecretService } from "@heptalogos/secret";
import type { TimeService } from "@heptalogos/time-service";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  type ConfigurationRevisionCreateActionInput,
  type ManagementDigest,
  type ProductSemanticId,
  type ProductSystemActionId,
  type SubjectStatusProjection,
  type SystemActionRequest,
  type SystemChangePlan,
  type TargetPrecondition,
  systemActionRequestSchema,
} from "../contracts.js";
import { invalidInputProblem } from "../problems.js";

/** Supplies the current Product semantic owners to the action families. */
export interface ManagementProductOwners {
  readonly configuration: ConfigurationService;
  readonly secret: SecretService;
  readonly networkAccess: NetworkAccessService;
  readonly aiRuntime: AIRuntimeService;
  readonly subject: SubjectManagementPort;
}

/** Narrow Subject owner seam used by Management without importing Product code. */
export interface SubjectManagementPort {
  /** Reads the current Subject status projection. */
  getStatus(): Promise<SubjectStatusProjection>;
  /** Starts the Subject for the expected authority revision. */
  start(input: {
    readonly subjectId: string;
    readonly expectedAuthorityRevision: number;
  }): Promise<SubjectStatusProjection>;
  /** Stops the Subject for the expected authority revision. */
  stop(input: {
    readonly subjectId: string;
    readonly expectedAuthorityRevision: number;
  }): Promise<SubjectStatusProjection>;
  readonly reconcileRuntime: () => Promise<void>;
}

/** Shared read/mutation context available to one finite action family. */
export interface SystemActionContext {
  readonly owners: ManagementProductOwners;
  readonly time: TimeService;
}

/** Internal runtime handler contract; the catalog is finite, not extensible. */
export interface SystemActionHandler {
  readonly actionIds: readonly ProductSystemActionId[];
  /** Normalizes one action request for its owning family. */
  normalize(
    request: SystemActionRequest,
    context: SystemActionContext,
  ): SystemActionRequest;
  /** Reads the target preconditions for one action request. */
  preconditions(
    action: SystemActionRequest,
    context: SystemActionContext,
  ): Promise<readonly TargetPrecondition[]>;
  /** Lists the semantic owners affected by one action request. */
  affectedOwners(
    action: SystemActionRequest,
    context: SystemActionContext,
  ): Promise<readonly ProductSemanticId[]>;
  /** Projects readiness and restart impact for one action request. */
  impact(
    action: SystemActionRequest,
    context: SystemActionContext,
  ): Promise<{
    readonly readiness: CanonicalJsonValue;
    readonly restart: CanonicalJsonValue;
  }>;
  /** Executes one action after the caller's plan fence succeeds. */
  execute(
    action: SystemActionRequest,
    context: SystemActionContext,
    expectedDigest?: string | null,
  ): Promise<CanonicalJsonValue>;
  /** Verifies the result against the current semantic owner state. */
  verify(
    action: SystemActionRequest,
    result: CanonicalJsonValue,
    context: SystemActionContext,
  ): Promise<boolean>;
  /** Computes the expected plan digest for one action. */
  expectedDigest(
    action: SystemActionRequest,
    preconditions: readonly TargetPrecondition[],
  ): string | null | undefined;
  /** Indicates whether execution needs explicit Subject runtime reconciliation. */
  reconcilesSubjectRuntime(action: SystemActionRequest): boolean;
}

/** Validates the current SystemAction request schema. */
const systemActionRequestValidator = compileSchema<SystemActionRequest>(
  systemActionRequestSchema,
);

/** Validates and returns one current SystemAction request. */
export function validatedAction(request: SystemActionRequest): SystemActionRequest {
  const validation = systemActionRequestValidator.validate(request);
  if (!validation.ok) {
    throw invalidInputProblem(
      validation.issues
        .map((issue) => issue.instancePath + " " + issue.message)
        .join("; "),
    );
  }
  return validation.value;
}

/** Creates a canonical JSON snapshot and serialized representation. */
export function canonicalObject(value: object): {
  readonly value: CanonicalJsonValue;
  readonly canonical: string;
} {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw invalidInputProblem("The Management action could not be canonicalized");
  }
  const parsed: unknown = JSON.parse(serialized);
  const snapshot = snapshotCanonicalJson(parsed as CanonicalJsonValue);
  return Object.freeze({ value: snapshot.value, canonical: snapshot.canonical });
}

/** Serializes one canonical JSON value. */
export function canonicalValue(value: CanonicalJsonValue): string {
  return snapshotCanonicalJson(value).canonical;
}

/** Computes a Management digest over one canonical object. */
function managementDigest(domain: string, value: object): ManagementDigest {
  return digestCanonicalJson(domain, canonicalObject(value).value)
    .hex as ManagementDigest;
}

/** Computes the digest of one normalized SystemAction request. */
export function normalizedInputDigest(action: SystemActionRequest): ManagementDigest {
  return digestCanonicalJson(
    "management.system-action.input.v1",
    canonicalObject(action).value,
  ).hex as ManagementDigest;
}

/** Validates a UUIDv7 value for one branded action field. */
export function requiredUuid(brand: string, value: string, field: string): string {
  if (parseUuidV7Id(brand, value) === undefined) {
    throw invalidInputProblem(field + " must be a UUIDv7 identifier");
  }
  return value;
}

/** Builds one canonical target precondition for an action plan. */
export function precondition(
  resourceKind: string,
  resourceId: string,
  current: object | undefined,
  digestDomain = "management.target.v1",
): TargetPrecondition {
  return Object.freeze({
    schemaVersion: 1 as const,
    resource: Object.freeze({
      schemaVersion: 1 as const,
      resourceKind,
      resourceId,
    }),
    ...(current === undefined
      ? {}
      : { expectedDigest: managementDigest(digestDomain, current) }),
  });
}

/** Builds the canonical resource id for a configuration scope. */
export function configurationResourceId(
  ref: ConfigurationRevisionCreateActionInput["scopeRef"],
): string {
  return ref.resourceKind + ":" + ref.resourceId;
}

/** Checks the exact capability set admitted by the current model route. */
export function exactModelCapabilities(
  capabilities: readonly string[],
): capabilities is readonly [
  "text-generation",
  "structured-output",
  "usage-metadata",
  "abort-timeout",
] {
  return (
    capabilities.length === 4 &&
    capabilities.every(
      (capability, index) =>
        capability ===
        ["text-generation", "structured-output", "usage-metadata", "abort-timeout"][
          index
        ],
    )
  );
}

/** Reads one bounded string field from a canonical action result. */
export function resultField(
  value: CanonicalJsonValue,
  field: string,
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const candidate = (value as { readonly [key: string]: CanonicalJsonValue })[field];
  return typeof candidate === "string" ? candidate : undefined;
}

/** Returns the standard readiness and reconciliation impact projection. */
export function standardImpact(): {
  readonly readiness: CanonicalJsonValue;
  readonly restart: CanonicalJsonValue;
} {
  return {
    readiness: Object.freeze({
      gatewayPrerequisiteReadiness: "re-evaluate",
      subjectDispatch: "re-evaluate",
    }) as unknown as CanonicalJsonValue,
    restart: Object.freeze({
      restartRequired: false,
      reconciliation: "immediate",
    }) as unknown as CanonicalJsonValue,
  };
}

/** Computes the canonical digest of one SystemChangePlan. */
export function actionPlanDigest(plan: SystemChangePlan): ManagementDigest {
  return digestCanonicalJson(
    "management.system-change-plan.v1",
    canonicalObject({
      schemaVersion: plan.schemaVersion,
      planId: plan.planId,
      actionId: plan.actionId,
      actionVersion: plan.actionVersion,
      normalizedInputDigest: plan.normalizedInputDigest,
      targetPreconditions: plan.targetPreconditions,
      affectedSemanticOwners: plan.affectedSemanticOwners,
      configurationReadinessSubjectImpact: plan.configurationReadinessSubjectImpact,
      restartReconcileImpact: plan.restartReconcileImpact,
      riskClass: plan.riskClass,
      createdAt: plan.createdAt,
      lineageContextRef: plan.lineageContextRef,
    }).value,
  ).hex as ManagementDigest;
}

/** Compares two target-precondition lists by canonical value. */
export function samePreconditions(
  left: readonly TargetPrecondition[],
  right: readonly TargetPrecondition[],
): boolean {
  return (
    canonicalObject({ value: left }).canonical ===
    canonicalObject({ value: right }).canonical
  );
}

/** Converts a validated action input into a canonical SecretRef. */
export function secretRefFromAction(value: {
  readonly schemaVersion: 1;
  readonly secretId: string;
}) {
  return Object.freeze({
    schemaVersion: 1 as const,
    secretId: parseUuidV7Id("SecretId", value.secretId)!,
  });
}

/** Throws a bounded Management configuration problem. */
