// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns AIRuntime route selection, profile/binding semantics, and commit fences.
 * @module routing
 */

import { createUuidV7Id, parseUuidV7Id } from "@heptalogos/foundation-contracts";
import type { ExecutionContext } from "@heptalogos/execution-lineage";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import {
  GATEWAY_TRANSPORT_DEFINITION_ID,
  type GatewayNetworkTarget,
} from "@heptalogos/network-access";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { SecretRef } from "@heptalogos/secret";
import {
  CURRENT_MODEL_CAPABILITIES,
  aiRuntimeReadinessSchema,
  type AIRuntimeReadiness,
  type AIRuntimeService,
  type AIRuntimeServiceOptions,
  type GenerationResult,
  type GatewayProfile,
  type GatewayProfileId,
  type ModelBinding,
  type ModelBindingCommitProvenance,
  type ModelBindingId,
  type ModelCapability,
  type ModelInvocationProtocol,
  type ModelProfile,
  type ModelProfileId,
  type SetGatewayProfileInput,
  type SetModelBindingInput,
  type SetModelProfileInput,
} from "./contracts.js";
import {
  aiRuntimeRepository,
  bindingDigest,
  canonicalBaseUrl,
  gatewayDigest,
  gatewayId,
  modelDigest,
  modelId,
} from "./repository.js";
import type { AIRuntimeRepository } from "./repository.js";
import { aiRuntimeProblem } from "./problems.js";

/** Owns configured AI routes and commit-time admissibility fences. */
export interface AIRuntimeRouting extends Pick<
  AIRuntimeService,
  | "listGatewayProfiles"
  | "listModelProfiles"
  | "listModelBindings"
  | "getGatewayProfile"
  | "getModelProfile"
  | "getModelBinding"
  | "setGatewayProfile"
  | "setModelProfile"
  | "setModelBinding"
  | "getReadiness"
  | "assertGenerationAdmissibleForCommit"
  | "assertModelBindingAdmissibleForCommit"
> {
  /** Reads one GatewayProfile inside the current caller context. */
  readGateway(id: GatewayProfileId): Promise<GatewayProfile | undefined>;
  /** Reads one ModelProfile inside the current caller context. */
  readModel(id: ModelProfileId): Promise<ModelProfile | undefined>;
  /** Reads one ModelBinding by role or identifier inside the current context. */
  readBinding(roleOrId: ModelBindingId | string): Promise<ModelBinding | undefined>;
  /** Returns the installation-scoped route key. */
  installationScope(): ReturnType<typeof installationScope>;
  /** Returns the gateway-scoped route key. */
  gatewayScope(id: GatewayProfileId): ReturnType<typeof gatewayScope>;
  /** Returns the network target for one gateway and invocation protocol. */
  networkTarget(
    gateway: GatewayProfile,
    protocol: ModelInvocationProtocol,
  ): GatewayNetworkTarget;
}

function assertInputText(value: string, field: string, maximum: number): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    throw aiRuntimeProblem(
      "ai.invalid_input",
      "AIRuntime input is invalid",
      field + " must be a bounded non-empty string",
      "validation",
    );
  }
}

function parseSecretRef(value: unknown, field: string): SecretRef {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== 1
  ) {
    throw aiRuntimeProblem(
      "ai.invalid_input",
      "AIRuntime input is invalid",
      field + " contains an invalid SecretRef",
      "validation",
    );
  }
  const secretId = value as { readonly secretId?: unknown };
  const parsed = parseUuidV7Id("SecretId", secretId.secretId);
  if (parsed === undefined) {
    throw aiRuntimeProblem(
      "ai.invalid_input",
      "AIRuntime input is invalid",
      field + ".secretId is invalid",
      "validation",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    secretId: parsed,
  });
}

function normalizedCapabilities(
  value: readonly ModelCapability[],
): readonly ModelCapability[] {
  const candidate = Array.isArray(value)
    ? value.filter((item): item is ModelCapability =>
        (CURRENT_MODEL_CAPABILITIES as readonly string[]).includes(item),
      )
    : [];
  const sortedCandidate = [...candidate].sort();
  const sortedExpected = [...CURRENT_MODEL_CAPABILITIES].sort();
  if (
    !Array.isArray(value) ||
    candidate.length !== value.length ||
    sortedCandidate.length !== sortedExpected.length ||
    sortedCandidate.join("\u0000") !== sortedExpected.join("\u0000")
  ) {
    throw aiRuntimeProblem(
      "ai.model_configuration_invalid",
      "ModelProfile capabilities are invalid",
      "The current ModelProfile must declare exactly the four current capabilities",
      "validation",
    );
  }
  return Object.freeze([...CURRENT_MODEL_CAPABILITIES]);
}

function currentActivity(options: AIRuntimeServiceOptions): ExecutionContext {
  const current = options.execution.current();
  if (current === undefined) {
    throw aiRuntimeProblem(
      "ai.invocation_activity_required",
      "AIRuntime invocation requires an Activity",
      "A provider generation must be attributed to current execution lineage",
      "conflict",
      "after-change",
    );
  }
  return current;
}

function installationScope(options: AIRuntimeServiceOptions) {
  return Object.freeze({
    schemaVersion: 1 as const,
    resourceKind: "installation",
    resourceId: currentActivity(options).origin.installationId,
  });
}

function gatewayScope(id: GatewayProfileId) {
  return Object.freeze({
    schemaVersion: 1 as const,
    resourceKind: "gateway-profile",
    resourceId: id,
  });
}

function networkTarget(
  gateway: GatewayProfile,
  invocationProtocol: ModelInvocationProtocol,
): GatewayNetworkTarget {
  return Object.freeze({
    schemaVersion: 1 as const,
    gatewayProfileId: gateway.gatewayProfileId,
    baseUrl: gateway.baseUrl,
    protocol: invocationProtocol,
  });
}

function staleResource(name: string): never {
  throw aiRuntimeProblem(
    "ai.stale_revision",
    name + " is stale",
    "The current resource changed after the action was planned",
    "conflict",
    "after-change",
  );
}

function assertExpected<T extends object>(
  actual: T | undefined,
  expected: string | null | undefined,
  digest: (value: T) => string,
  name: string,
): void {
  if (expected === undefined) return;
  if (expected === null) {
    if (actual !== undefined) staleResource(name);
    return;
  }
  if (actual === undefined || digest(actual) !== expected) staleResource(name);
}

async function assertModelBindingAdmissible(
  repository: AIRuntimeRepository,
  transaction: import("@heptalogos/persistence/repository").PersistenceInternalTransaction,
  provenance: ModelBindingCommitProvenance,
): Promise<void> {
  const binding = await repository.readBindingForCommit(
    transaction,
    provenance.modelBindingId,
  );
  const model =
    binding === undefined
      ? undefined
      : await repository.readModelForCommit(transaction, binding.modelProfileId);
  const gateway =
    model === undefined
      ? undefined
      : await repository.readGatewayForCommit(transaction, model.gatewayProfileId);
  if (
    binding === undefined ||
    !binding.enabled ||
    binding.revision !== provenance.bindingRevision ||
    binding.modelBindingId !== provenance.modelBindingId ||
    model === undefined ||
    model.modelProfileId !== provenance.modelProfileId ||
    model.generation !== provenance.modelProfileGeneration ||
    model.gatewayProfileId !== provenance.gatewayProfileId ||
    model.modelIdentifier !== provenance.modelIdentifier ||
    model.protocol !== provenance.protocol ||
    gateway === undefined ||
    gateway.gatewayProfileId !== provenance.gatewayProfileId ||
    !gateway.enabled
  ) {
    throw aiRuntimeProblem(
      "ai.generation_mismatch",
      "AIRuntime model route is no longer admissible",
      "The binding, model, or gateway changed before the owning commit",
      "conflict",
      "after-change",
    );
  }
}

/** Creates the direct AIRuntime routing owner. */
export function createAIRuntimeRouting(
  options: AIRuntimeServiceOptions,
  repository: AIRuntimeRepository = aiRuntimeRepository,
): AIRuntimeRouting {
  const readGateway = (id: GatewayProfileId) =>
    repository.readGateway(options.persistence, id);
  const readModel = (id: ModelProfileId) =>
    repository.readModel(options.persistence, id);
  const readBinding = (roleOrId: ModelBindingId | string) =>
    repository.readBinding(options.persistence, roleOrId);

  const setGatewayProfile = async (
    input: SetGatewayProfileInput,
    expectedDigest?: string | null,
  ): Promise<GatewayProfile> => {
    const existingId = gatewayId(input.gatewayProfileId);
    if (input.apiTokenSecretRef !== undefined && existingId === undefined) {
      throw aiRuntimeProblem(
        "ai.invalid_input",
        "GatewayProfile input is invalid",
        "A gateway token SecretRef requires an explicit GatewayProfileId",
        "validation",
      );
    }
    const gatewayProfileId =
      existingId ?? (createUuidV7Id("GatewayProfileId") as GatewayProfileId);
    const baseUrl = canonicalBaseUrl(input.baseUrl);
    const apiTokenSecretRef =
      input.apiTokenSecretRef === undefined
        ? undefined
        : parseSecretRef(input.apiTokenSecretRef, "apiTokenSecretRef");
    if (apiTokenSecretRef !== undefined) {
      const secret = await options.secret.getMetadata(apiTokenSecretRef);
      if (
        secret === undefined ||
        secret.state !== "ACTIVE" ||
        secret.purpose !== "ai.gateway.bearer-token" ||
        secret.scopeRef?.resourceKind !== "gateway-profile" ||
        secret.scopeRef.resourceId !== gatewayProfileId
      ) {
        throw aiRuntimeProblem(
          "ai.secret_unavailable",
          "GatewayProfile SecretRef is not usable",
          "The attached SecretRef must be an active bearer token scoped to this GatewayProfile",
          "conflict",
          "after-change",
        );
      }
    }
    let written: GatewayProfile | undefined;
    await options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (transaction) => {
        const current = await repository.readGatewayForCommit(
          transaction,
          gatewayProfileId,
        );
        assertExpected(current, expectedDigest, gatewayDigest, "GatewayProfile");
        if (current !== undefined && current.baseUrl !== baseUrl) {
          throw aiRuntimeProblem(
            "ai.gateway_destination_immutable",
            "GatewayProfile base URL is immutable",
            "Create a new GatewayProfile when the configured destination changes",
            "conflict",
            "after-change",
          );
        }
        written = await repository.upsertGateway(transaction, {
          gatewayProfileId,
          baseUrl,
          apiTokenSecretId: apiTokenSecretRef?.secretId,
          enabled: input.enabled,
          lineageContextRef: options.execution.createLineageContextRef(),
        });
        if (written === undefined) staleResource("GatewayProfile");
        await options.evidence.recordRequired(context, {
          evidenceKind: "ai.gateway-profile.changed",
          evidenceContractVersion: "ai-runtime.v1",
          objectRef: gatewayProfileId,
          retentionClass: "retained",
          sensitivity: "operational",
        });
      }),
    );
    return written!;
  };

  const setModelProfile = async (
    input: SetModelProfileInput,
    expectedDigest?: string | null,
  ): Promise<ModelProfile> => {
    const existingId = modelId(input.modelProfileId);
    const modelProfileId =
      existingId ?? (createUuidV7Id("ModelProfileId") as ModelProfileId);
    const gatewayProfileId = gatewayId(input.gatewayProfileId);
    if (
      gatewayProfileId === undefined ||
      (await readGateway(gatewayProfileId)) === undefined
    ) {
      throw aiRuntimeProblem(
        "ai.gateway_unavailable",
        "GatewayProfile was not found",
        "ModelProfile must reference an existing GatewayProfile",
        "conflict",
        "after-change",
      );
    }
    if (input.protocol !== "openai-chat" && input.protocol !== "openai-responses") {
      throw aiRuntimeProblem(
        "ai.model_configuration_invalid",
        "ModelProfile protocol is invalid",
        "Only openai-chat and openai-responses are current invocation protocols",
        "validation",
      );
    }
    assertInputText(input.modelIdentifier, "modelIdentifier", 256);
    const consumedCapabilities = normalizedCapabilities(input.consumedCapabilities);
    let written: ModelProfile | undefined;
    await options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (transaction) => {
        const current = await repository.readModelForCommit(
          transaction,
          modelProfileId,
        );
        assertExpected(current, expectedDigest, modelDigest, "ModelProfile");
        written = await repository.upsertModel(transaction, {
          modelProfileId,
          gatewayProfileId,
          modelIdentifier: input.modelIdentifier,
          protocol: input.protocol,
          consumedCapabilities,
          generation: current === undefined ? 1 : current.generation + 1,
          lineageContextRef: options.execution.createLineageContextRef(),
        });
        if (written === undefined) staleResource("ModelProfile");
        await options.evidence.recordRequired(context, {
          evidenceKind: "ai.model-profile.changed",
          evidenceContractVersion: "ai-runtime.v1",
          objectRef: modelProfileId,
          retentionClass: "retained",
          sensitivity: "operational",
        });
      }),
    );
    return written!;
  };

  const setModelBinding = async (
    input: SetModelBindingInput,
    expectedDigest?: string | null,
  ): Promise<ModelBinding> => {
    const modelProfileId = modelId(input.modelProfileId);
    if (
      modelProfileId === undefined ||
      (await readModel(modelProfileId)) === undefined
    ) {
      throw aiRuntimeProblem(
        "ai.model_unavailable",
        "ModelProfile was not found",
        "ModelBinding must reference an existing ModelProfile",
        "conflict",
        "after-change",
      );
    }
    const newModelBindingId = createUuidV7Id("ModelBindingId") as ModelBindingId;
    let written: ModelBinding | undefined;
    await options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (transaction) => {
        const current = await repository.readBindingByRoleForCommit(
          transaction,
          input.role,
        );
        assertExpected(current, expectedDigest, bindingDigest, "ModelBinding");
        const modelBindingId = current?.modelBindingId ?? newModelBindingId;
        written = await repository.upsertBinding(transaction, {
          modelBindingId,
          role: input.role,
          modelProfileId,
          revision: current === undefined ? 1 : current.revision + 1,
          lineageContextRef: options.execution.createLineageContextRef(),
        });
        if (written === undefined) staleResource("ModelBinding");
        await options.evidence.recordRequired(context, {
          evidenceKind: "ai.model-binding.changed",
          evidenceContractVersion: "ai-runtime.v1",
          objectRef: written.modelBindingId,
          retentionClass: "retained",
          sensitivity: "operational",
        });
      }),
    );
    return written!;
  };

  const listGatewayProfiles = () => repository.listGateways(options.persistence);
  const listModelProfiles = () => repository.listModels(options.persistence);
  const listModelBindings = () => repository.listBindings(options.persistence);

  const getReadiness = async (): Promise<AIRuntimeReadiness> => {
    const blockers: string[] = [];
    const [activeConfig, gateways, models, bindings] = await Promise.all([
      options.configuration.getEffectiveRevision(
        GATEWAY_TRANSPORT_DEFINITION_ID,
        installationScope(options),
      ),
      listGatewayProfiles(),
      listModelProfiles(),
      listModelBindings(),
    ]);
    if (activeConfig === undefined) blockers.push("configuration");
    for (const role of ["subject.primary", "subject.expression"] as const) {
      const binding = bindings.find((item) => item.role === role);
      if (binding === undefined || !binding.enabled) {
        blockers.push("binding." + role);
        continue;
      }
      const model = models.find(
        (item) => item.modelProfileId === binding.modelProfileId,
      );
      if (model === undefined) {
        blockers.push("model." + role);
        continue;
      }
      const gateway = gateways.find(
        (item) => item.gatewayProfileId === model.gatewayProfileId,
      );
      if (gateway === undefined || !gateway.enabled) {
        blockers.push("gateway." + role);
        continue;
      }
      try {
        options.networkAccess.authorizeGatewayTarget(
          networkTarget(gateway, model.protocol),
        );
      } catch {
        blockers.push("network." + role);
      }
      if (gateway.apiTokenSecretRef !== undefined) {
        const secret = await options.secret.getMetadata(gateway.apiTokenSecretRef);
        if (secret?.state !== "ACTIVE") {
          blockers.push("secret." + role);
        } else {
          try {
            const material = await options.secret.resolve(gateway.apiTokenSecretRef, {
              consumer: "system.ai-runtime",
              purpose: "ai.gateway.bearer-token",
              resourceRef: gatewayScope(gateway.gatewayProfileId),
            });
            material.bytes.fill(0);
          } catch {
            blockers.push("secret." + role);
          }
        }
      }
    }
    const readiness: AIRuntimeReadiness = Object.freeze({
      schemaVersion: 1,
      state: blockers.length === 0 ? "READY" : "BLOCKED",
      blockers: Object.freeze([...new Set(blockers)]),
    });
    const validation = compileSchema<AIRuntimeReadiness>(
      aiRuntimeReadinessSchema,
    ).validate(readiness);
    if (!validation.ok) {
      throw aiRuntimeProblem(
        "ai.readiness_invalid",
        "AIRuntime readiness projection is invalid",
        "The current readiness owner produced an invalid projection",
        "integrity",
      );
    }
    return readiness;
  };

  const assertGenerationAdmissibleForCommit = async (
    transaction: PersistenceMutationTransactionContext,
    provenance: GenerationResult,
  ): Promise<void> => {
    await useRepositoryMutationTransaction(transaction, async (databaseTransaction) => {
      await assertModelBindingAdmissible(repository, databaseTransaction, provenance);
      const activeRevisionId = await repository.readTransportActivation(
        databaseTransaction,
        transaction.execution.installationId,
      );
      if (activeRevisionId !== provenance.configurationRevisionId) {
        throw aiRuntimeProblem(
          "ai.generation_mismatch",
          "AIRuntime generation is no longer admissible",
          "The binding, model, gateway, or transport configuration changed before commit",
          "conflict",
          "after-change",
        );
      }
    });
  };

  const assertModelBindingAdmissibleForCommit = async (
    transaction: PersistenceMutationTransactionContext,
    provenance: ModelBindingCommitProvenance,
  ): Promise<void> => {
    await useRepositoryMutationTransaction(transaction, (databaseTransaction) =>
      assertModelBindingAdmissible(repository, databaseTransaction, provenance),
    );
  };

  return Object.freeze({
    listGatewayProfiles,
    listModelProfiles,
    listModelBindings,
    getGatewayProfile: async (value: GatewayProfileId | string) => {
      const id = gatewayId(value);
      return id === undefined ? undefined : readGateway(id);
    },
    getModelProfile: async (value: ModelProfileId | string) => {
      const id = modelId(value);
      return id === undefined ? undefined : readModel(id);
    },
    getModelBinding: readBinding,
    setGatewayProfile,
    setModelProfile,
    setModelBinding,
    getReadiness,
    assertGenerationAdmissibleForCommit,
    assertModelBindingAdmissibleForCommit,
    readGateway,
    readModel,
    readBinding,
    installationScope: () => installationScope(options),
    gatewayScope,
    networkTarget,
  });
}
