// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Registers and resolves generation-pinned WorkHandlers, rejecting stale or
 * mismatched declarations before an attempt can reach product execution.
 * @module work-handler-registry
 */

import {
  canonicalizeJson,
  POSTGRES_INTEGER_MAX,
  parseContentDigest,
  parseContributionId,
  parseMicroSystemId,
  snapshotCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { compileSchema, type SchemaValidator } from "@heptalogos/schema-runtime";
import type { RuntimeActivityRunner } from "@heptalogos/execution-lineage/runtime-kernel";
import { GenerationFence } from "../generation/generation-fence.js";
import { runtimeKernelProblem } from "../problems.js";
import { RegistryStore, retireRegistryGeneration } from "./registry-store.js";
import {
  type RuntimeWorkHandler,
  type RuntimeWorkHandlerInvocation,
  type RuntimeWorkHandlerInvocationReservation,
  type RuntimeWorkHandlerLease,
  type RuntimeWorkHandlerResult,
  type WorkHandlerPayloadContract,
  type WorkHandlerProvisionDescriptor,
  type WorkHandlerRegistration,
  type WorkHandlerRegistrationOwner,
  type WorkHandlerTarget,
} from "../model/work-handler-contracts.js";

const namespacedIdShape = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const restoreReplayClasses = new Set(["RECONCILE_REQUIRED", "RESTORE_SAFE"]);

interface CompiledWorkHandlerRegistration extends WorkHandlerRegistration {
  readonly payloadValidators: ReadonlyMap<number, SchemaValidator<unknown>>;
  readonly outcomeValidator: SchemaValidator<unknown>;
}

function keyFor(
  owner: WorkHandlerRegistrationOwner,
  contributionId: WorkHandlerProvisionDescriptor["contributionId"],
): string {
  return `${owner.microSystemId}\u0000${contributionId}\u0000${owner.packageGenerationId}`;
}

function isBoundedNamespacedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    namespacedIdShape.test(value)
  );
}

function descriptorProblem(detail: string): never {
  throw runtimeKernelProblem("runtime.work_handler.invalid_descriptor", detail);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function snapshotSchema(
  schema: Readonly<Record<string, unknown>>,
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    const snapshot = JSON.parse(
      canonicalizeJson(schema as CanonicalJsonValue),
    ) as Readonly<Record<string, unknown>>;
    return deepFreeze(snapshot);
  } catch {
    descriptorProblem(`${label} must be canonical JSON`);
  }
}

function normalizedPayloadContracts(
  payloadContracts: readonly WorkHandlerPayloadContract[],
): readonly WorkHandlerPayloadContract[] {
  return [...payloadContracts].sort((left, right) => left.version - right.version);
}

/** Canonicalizes handler descriptor fields for stable equality and fencing. */
export function canonicalizeWorkHandlerDescriptor(
  descriptor: WorkHandlerProvisionDescriptor,
): string {
  const payloadContracts = normalizedPayloadContracts(descriptor.payloadContracts).map(
    (contract) => ({
      version: contract.version,
      schema: contract.schema as CanonicalJsonValue,
    }),
  );
  return canonicalizeJson({
    contributionId: descriptor.contributionId,
    contractVersion: descriptor.contractVersion,
    payloadContracts,
    outcomeSchema: descriptor.outcomeSchema as CanonicalJsonValue,
    queueProfileId: descriptor.queueProfileId,
    resourceAdmissionClass: descriptor.resourceAdmissionClass,
    configurationBindingPolicy: descriptor.configurationBindingPolicy,
    restoreReplayClass: descriptor.restoreReplayClass,
  });
}

/** Compares handler descriptors by their canonical semantic representation. */
export function workHandlerDescriptorsEqual(
  left: WorkHandlerProvisionDescriptor,
  right: WorkHandlerProvisionDescriptor,
): boolean {
  try {
    return (
      canonicalizeWorkHandlerDescriptor(left) ===
      canonicalizeWorkHandlerDescriptor(right)
    );
  } catch {
    return false;
  }
}

function snapshotDescriptor(
  descriptor: WorkHandlerProvisionDescriptor,
): WorkHandlerProvisionDescriptor {
  const payloadContracts = normalizedPayloadContracts(descriptor.payloadContracts).map(
    (contract) =>
      Object.freeze({
        version: contract.version,
        schema: snapshotSchema(
          contract.schema,
          `WorkHandler payload schema for version ${contract.version}`,
        ),
      }),
  );
  return Object.freeze({
    contributionId: descriptor.contributionId,
    contractVersion: descriptor.contractVersion,
    payloadContracts: Object.freeze(payloadContracts),
    outcomeSchema: snapshotSchema(
      descriptor.outcomeSchema,
      "WorkHandler outcome schema",
    ),
    queueProfileId: descriptor.queueProfileId,
    resourceAdmissionClass: descriptor.resourceAdmissionClass,
    configurationBindingPolicy: descriptor.configurationBindingPolicy,
    restoreReplayClass: descriptor.restoreReplayClass,
  });
}

function compilePayloadContract(
  contract: WorkHandlerPayloadContract,
): SchemaValidator<unknown> {
  if (
    !Number.isSafeInteger(contract.version) ||
    contract.version < 1 ||
    contract.version > POSTGRES_INTEGER_MAX
  ) {
    descriptorProblem(
      "WorkHandler payload contract versions must be positive integers",
    );
  }
  if (
    typeof contract.schema !== "object" ||
    contract.schema === null ||
    Array.isArray(contract.schema)
  ) {
    descriptorProblem("WorkHandler payload schema must be a JSON Schema object");
  }
  try {
    return compileSchema<unknown>(contract.schema);
  } catch {
    descriptorProblem(
      `WorkHandler payload schema for version ${contract.version} is not a strict JSON Schema`,
    );
  }
}

function compileOutcomeSchema(
  schema: Readonly<Record<string, unknown>>,
): SchemaValidator<unknown> {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    descriptorProblem("WorkHandler outcome schema must be a JSON Schema object");
  }
  try {
    return compileSchema<unknown>(schema);
  } catch {
    descriptorProblem("WorkHandler outcome schema is not a strict JSON Schema");
  }
}

function validateDescriptor(
  descriptor: WorkHandlerProvisionDescriptor,
): ReadonlyMap<number, SchemaValidator<unknown>> {
  if (parseContributionId(descriptor.contributionId) === undefined) {
    descriptorProblem("WorkHandler contributionId is invalid");
  }
  if (
    typeof descriptor.contractVersion !== "string" ||
    descriptor.contractVersion.length === 0 ||
    descriptor.contractVersion.length > 64 ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(descriptor.contractVersion)
  ) {
    descriptorProblem("WorkHandler contractVersion is invalid");
  }
  if (!isBoundedNamespacedId(descriptor.queueProfileId)) {
    descriptorProblem("WorkHandler queueProfileId is invalid");
  }
  if (!isBoundedNamespacedId(descriptor.resourceAdmissionClass)) {
    descriptorProblem("WorkHandler resourceAdmissionClass is invalid");
  }
  if (descriptor.configurationBindingPolicy !== "LATEST_COMPATIBLE_AT_ATTEMPT") {
    throw runtimeKernelProblem(
      "runtime.work-handler.configuration-binding-unavailable",
      "Current WorkHandlers require configuration-free latest-compatible binding",
    );
  }
  if (!restoreReplayClasses.has(descriptor.restoreReplayClass)) {
    descriptorProblem("WorkHandler restoreReplayClass is invalid");
  }
  if (descriptor.payloadContracts.length === 0) {
    descriptorProblem("WorkHandler must declare at least one payload contract");
  }
  const validators = new Map<number, SchemaValidator<unknown>>();
  for (const contract of descriptor.payloadContracts) {
    if (validators.has(contract.version)) {
      descriptorProblem("WorkHandler payload contract versions must be unique");
    }
    validators.set(contract.version, compilePayloadContract(contract));
  }
  return validators;
}

function validationFailure(
  problemCode: string,
  label: string,
  version: number | undefined,
  issues: readonly { readonly instancePath: string; readonly message: string }[],
): never {
  const suffix = version === undefined ? "" : ` for version ${version}`;
  throw runtimeKernelProblem(
    problemCode,
    `${label}${suffix} failed schema validation: ${issues
      .map((issue) => `${issue.instancePath} ${issue.message}`)
      .join("; ")}`,
  );
}

function validateValue(
  validator: SchemaValidator<unknown>,
  value: unknown,
  problemCode: string,
  label: string,
  version?: number,
): unknown {
  const result = validator.validate(value);
  if (!result.ok) {
    validationFailure(problemCode, label, version, result.issues);
  }
  return result.value;
}

function isWorkHandlerResult(value: unknown): value is RuntimeWorkHandlerResult {
  return typeof value === "object" && value !== null && "outcome" in value;
}

function createLease(
  registration: CompiledWorkHandlerRegistration,
  requestedTarget: WorkHandlerTarget,
): RuntimeWorkHandlerLease {
  const validatePayloadValue = (version: number, value: unknown): unknown => {
    const validator = registration.payloadValidators.get(version);
    if (validator === undefined) {
      throw runtimeKernelProblem(
        "runtime.work_handler.payload_version_unavailable",
        `WorkHandler does not accept payload version ${version}`,
      );
    }
    return validateValue(
      validator,
      value,
      "runtime.work_handler.payload_invalid",
      "WorkHandler payload",
      version,
    );
  };
  const validateOutcomeValue = (value: unknown): unknown =>
    validateValue(
      registration.outcomeValidator,
      value,
      "runtime.work_handler.outcome_invalid",
      "WorkHandler outcome",
    );

  return Object.freeze({
    target: requestedTarget,
    descriptor: registration.descriptor,
    runtimeActivity: registration.runtimeActivity,
    validatePayload(version: number, value: unknown) {
      registration.fence.assertActive();
      return validatePayloadValue(version, value) as never;
    },
    reserveInvocation(): RuntimeWorkHandlerInvocationReservation {
      const reservation = registration.fence.reserve(
        `work-handler.${registration.descriptor.contributionId}`,
      );
      const execute = (
        input: RuntimeWorkHandlerInvocation,
      ): Promise<RuntimeWorkHandlerResult> => {
        const invoke = (): Promise<RuntimeWorkHandlerResult> =>
          Promise.resolve(
            reservation.run(async () => {
              const handlerResult = await registration.implementation.execute(input);
              if (!isWorkHandlerResult(handlerResult)) {
                throw runtimeKernelProblem(
                  "runtime.work_handler.invalid_result",
                  "WorkHandler returned a value without an outcome field",
                );
              }
              const outcome = validateOutcomeValue(handlerResult.outcome);
              let snapshot: ReturnType<typeof snapshotCanonicalJson>;
              try {
                snapshot = snapshotCanonicalJson(outcome as CanonicalJsonValue);
              } catch (cause) {
                throw runtimeKernelProblem(
                  "runtime.work_handler.outcome_invalid",
                  "WorkHandler outcome is not canonical JSON",
                  cause,
                );
              }
              return Object.freeze({ outcome: snapshot.value as never });
            }),
          );

        try {
          if (registration.runtimeActivity === undefined) return invoke();
          return registration.runtimeActivity
            .runActivity(
              {
                kind: "contribution.invoke",
                importance: "routine",
                retentionClass: "ephemeral",
                sensitivity: "operational",
                semantic: {
                  operationId: `work-handler.${registration.descriptor.contributionId}`,
                  contractVersion: registration.descriptor.contractVersion,
                },
              },
              async () => invoke(),
            )
            .catch((error) => {
              reservation.release();
              throw error;
            });
        } catch (error) {
          reservation.release();
          throw error;
        }
      };
      return Object.freeze({
        execute,
        release: () => reservation.release(),
      });
    },
  });
}

/** Owns generation-pinned WorkHandler registration and lookup. */
export class WorkHandlerRegistry {
  private readonly registrations = new RegistryStore<CompiledWorkHandlerRegistration>();

  /** Registers and validates one handler for an exact Runtime generation. */
  register(
    owner: WorkHandlerRegistrationOwner,
    descriptor: WorkHandlerProvisionDescriptor,
    implementation: RuntimeWorkHandler,
    fence = new GenerationFence(),
    runtimeActivity?: RuntimeActivityRunner,
  ): GenerationFence {
    if (
      parseContentDigest("ProductGenerationId", owner.productGenerationId) ===
        undefined ||
      parseContentDigest("PackageGenerationId", owner.packageGenerationId) ===
        undefined ||
      parseMicroSystemId(owner.microSystemId) === undefined
    ) {
      descriptorProblem(
        "WorkHandler registration owner has an invalid generation identity",
      );
    }
    if (typeof implementation !== "object" || implementation === null) {
      descriptorProblem("WorkHandler implementation must be an object");
    }
    if (typeof implementation.execute !== "function") {
      descriptorProblem("WorkHandler implementation must expose execute");
    }
    const snapshottedDescriptor = snapshotDescriptor(descriptor);
    const payloadValidators = validateDescriptor(snapshottedDescriptor);
    const outcomeValidator = compileOutcomeSchema(snapshottedDescriptor.outcomeSchema);
    const key = keyFor(owner, descriptor.contributionId);
    if (this.registrations.has(key)) {
      throw runtimeKernelProblem(
        "runtime.work_handler.duplicate_registration",
        `WorkHandler '${descriptor.contributionId}' is already registered for MicroSystem '${owner.microSystemId}' and PackageGeneration '${owner.packageGenerationId}'`,
      );
    }
    this.registrations.set(key, {
      owner,
      descriptor: snapshottedDescriptor,
      implementation,
      fence,
      runtimeActivity,
      payloadValidators,
      outcomeValidator,
    });
    return fence;
  }

  /** Resolves a live handler lease for an exact target and payload version. */
  resolve(target: WorkHandlerTarget): RuntimeWorkHandlerLease | undefined {
    const key = `${target.microSystemId}\u0000${target.contributionId}\u0000${target.packageGenerationId}`;
    const registration = this.registrations.get(key);
    if (
      registration === undefined ||
      registration.owner.productGenerationId !== target.productGenerationId ||
      registration.fence.state !== "ACTIVE" ||
      !registration.payloadValidators.has(target.payloadVersion)
    ) {
      return undefined;
    }
    return createLease(registration, target);
  }

  /** Retires all handler registrations owned by one generation fence. */
  async retireGeneration(
    fence: GenerationFence,
    settleTimeoutMs: number,
  ): Promise<void> {
    await retireRegistryGeneration(this.registrations, fence, settleTimeoutMs);
  }

  /** Reports the number of registered handler targets. */
  size(): number {
    return this.registrations.size;
  }
}
