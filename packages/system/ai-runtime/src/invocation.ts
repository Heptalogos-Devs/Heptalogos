// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns the provider invocation adapter behind the AIRuntime contract.
 * @module invocation
 */

import {
  parseInstant,
  snapshotCanonicalJson,
  ProblemError,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { decodeLineageContextRef } from "@heptalogos/execution-lineage";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import { compileSchema } from "@heptalogos/schema-runtime";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { injectJsonInstructionIntoMessages } from "@ai-sdk/provider-utils";
import { generateText, jsonSchema, Output, type ModelMessage } from "ai";
import type {
  AIRuntimeServiceOptions,
  GenerationResult,
  InvocationSpec,
  UsageMetadata,
} from "./contracts.js";
import type { AIRuntimeRouting } from "./routing.js";
import { GATEWAY_TRANSPORT_DEFINITION_ID } from "@heptalogos/network-access";
import { aiRuntimeProblem } from "./problems.js";

/** Owns bounded provider invocation mechanics behind the AIRuntime boundary. */
export interface AIRuntimeInvocation {
  /** Invokes one validated structured provider request. */
  invoke(spec: InvocationSpec): Promise<GenerationResult>;
}

function currentActivity(options: AIRuntimeServiceOptions) {
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

function validateInvocation(
  spec: InvocationSpec,
  options: AIRuntimeServiceOptions,
): void {
  const current = currentActivity(options);
  if (spec.ownerActivityRef !== current.activityId) {
    throw aiRuntimeProblem(
      "ai.invocation_activity_mismatch",
      "Invocation Activity does not match current execution",
      "InvocationSpec ownerActivityRef must identify the current Activity",
      "conflict",
      "after-change",
    );
  }
  const lineage = decodeLineageContextRef(spec.lineageContextRef);
  if (
    lineage.sourceActivityId !== current.activityId ||
    lineage.sourceInstanceId !== current.origin.instanceId ||
    lineage.sourceContinuityEpochId !== current.origin.continuityEpochId
  ) {
    throw aiRuntimeProblem(
      "ai.invocation_lineage_mismatch",
      "Invocation lineage is invalid",
      "InvocationSpec lineage must continue the current Activity",
      "conflict",
      "after-change",
    );
  }
  if (
    !Number.isSafeInteger(spec.expectedBindingRevision) ||
    spec.expectedBindingRevision < 1 ||
    !Number.isSafeInteger(spec.budget.maxOutputTokens) ||
    spec.budget.maxOutputTokens < 1 ||
    spec.budget.maxOutputTokens > 32_768
  ) {
    throw aiRuntimeProblem(
      "ai.invalid_input",
      "Invocation budget is invalid",
      "maxOutputTokens must be a positive bounded integer",
      "validation",
    );
  }
  if (
    typeof spec.objective !== "string" ||
    spec.objective.trim().length === 0 ||
    spec.objective.length > 512
  ) {
    throw aiRuntimeProblem(
      "ai.invalid_input",
      "AIRuntime input is invalid",
      "objective must be a bounded non-empty string",
      "validation",
    );
  }
  if (
    !Array.isArray(spec.messages) ||
    spec.messages.length === 0 ||
    spec.messages.some(
      (message) =>
        !["system", "user", "assistant"].includes(message.role) ||
        typeof message.text !== "string" ||
        message.text.length === 0 ||
        message.text.length > 64 * 1024,
    )
  ) {
    throw aiRuntimeProblem(
      "ai.invalid_input",
      "Invocation messages are invalid",
      "AIRuntime accepts bounded system/user/assistant text messages",
      "validation",
    );
  }
  if (
    typeof spec.outputSchema !== "object" ||
    spec.outputSchema === null ||
    Array.isArray(spec.outputSchema)
  ) {
    throw aiRuntimeProblem(
      "ai.output_schema_invalid",
      "Invocation output schema is invalid",
      "Structured generation requires a JSON Schema object",
      "validation",
    );
  }
}

function normalizeUsage(value: {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}): UsageMetadata | undefined {
  const usage: UsageMetadata = {
    ...(value.inputTokens === undefined ? {} : { inputTokens: value.inputTokens }),
    ...(value.outputTokens === undefined ? {} : { outputTokens: value.outputTokens }),
    ...(value.totalTokens === undefined ? {} : { totalTokens: value.totalTokens }),
  };
  return Object.keys(usage).length === 0 ? undefined : Object.freeze(usage);
}

function modelPrompt(messages: InvocationSpec["messages"]): {
  readonly system?: string;
  readonly messages: ModelMessage[];
} {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.text)
    .join("\n");
  return {
    ...(system.length === 0 ? {} : { system }),
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.text,
      })),
  };
}

function chatSystemPrompt(
  prompt: string | undefined,
  schema: InvocationSpec["outputSchema"],
): string {
  const instructed = injectJsonInstructionIntoMessages({
    messages: (prompt === undefined
      ? []
      : [{ role: "system" as const, content: prompt }]) as Parameters<
      typeof injectJsonInstructionIntoMessages
    >[0]["messages"],
    schema: schema as Parameters<typeof injectJsonInstructionIntoMessages>[0]["schema"],
  });
  const system = instructed[0];
  if (system?.role !== "system" || typeof system.content !== "string") {
    throw aiRuntimeProblem(
      "ai.output_schema_invalid",
      "AIRuntime could not prepare the Chat schema instruction",
      "The installed AI SDK helper did not produce a system instruction",
      "integrity",
    );
  }
  return system.content;
}

/** Creates the direct AIRuntime invocation owner. */
export function createAIRuntimeInvocation(
  options: AIRuntimeServiceOptions,
  routing: AIRuntimeRouting,
): AIRuntimeInvocation {
  const invoke = async (spec: InvocationSpec): Promise<GenerationResult> => {
    validateInvocation(spec, options);
    const binding = await routing.readBinding(spec.modelBindingId);
    if (binding === undefined) {
      throw aiRuntimeProblem(
        "ai.model_binding_unavailable",
        "ModelBinding was not found",
        "The requested current ModelBinding does not exist",
        "conflict",
        "after-change",
      );
    }
    if (!binding.enabled || binding.revision !== spec.expectedBindingRevision) {
      throw aiRuntimeProblem(
        "ai.model_binding_stale",
        "ModelBinding is stale",
        "The requested binding revision is no longer current",
        "conflict",
        "after-change",
      );
    }
    const model = await routing.readModel(binding.modelProfileId);
    if (model === undefined) {
      throw aiRuntimeProblem(
        "ai.model_binding_unavailable",
        "ModelProfile was not found",
        "The current ModelBinding points to no ModelProfile",
        "conflict",
        "after-change",
      );
    }
    const gateway = await routing.readGateway(model.gatewayProfileId);
    if (gateway === undefined || !gateway.enabled) {
      throw aiRuntimeProblem(
        "ai.gateway_unavailable",
        "GatewayProfile is unavailable",
        "The current ModelProfile does not resolve to an enabled gateway",
        "unavailable",
        "after-change",
      );
    }
    const activeConfig = await options.configuration.getEffectiveRevision(
      GATEWAY_TRANSPORT_DEFINITION_ID,
      routing.installationScope(),
    );
    if (activeConfig === undefined) {
      throw aiRuntimeProblem(
        "ai.gateway_configuration_invalid",
        "Gateway transport configuration is unavailable",
        "An active gateway transport ConfigurationRevision is required",
        "conflict",
        "after-change",
      );
    }
    const target = routing.networkTarget(gateway, model.protocol);
    try {
      options.networkAccess.authorizeGatewayTarget(target);
    } catch {
      throw aiRuntimeProblem(
        "ai.network_unavailable",
        "Gateway network route is unavailable",
        "NetworkAccess cannot authorize the selected GatewayProfile protocol endpoint",
        "conflict",
        "after-change",
      );
    }
    let apiKey: string | undefined;
    if (gateway.apiTokenSecretRef !== undefined) {
      let material;
      try {
        material = await options.secret.resolve(gateway.apiTokenSecretRef, {
          consumer: "system.ai-runtime",
          purpose: "ai.gateway.bearer-token",
          resourceRef: routing.gatewayScope(gateway.gatewayProfileId),
        });
      } catch {
        throw aiRuntimeProblem(
          "ai.secret_unavailable",
          "Gateway SecretRef is unavailable",
          "The configured gateway bearer token could not be resolved",
          "unavailable",
          "after-change",
        );
      }
      try {
        apiKey = new TextDecoder("utf-8", { fatal: true }).decode(material.bytes);
      } catch {
        material.bytes.fill(0);
        throw aiRuntimeProblem(
          "ai.secret_unavailable",
          "Gateway SecretRef is invalid",
          "The configured gateway token is not valid UTF-8",
          "integrity",
        );
      }
      material.bytes.fill(0);
      if (apiKey.length === 0) {
        throw aiRuntimeProblem(
          "ai.secret_unavailable",
          "Gateway SecretRef is empty",
          "The configured gateway token is empty",
          "integrity",
        );
      }
    }
    const remainingMs =
      spec.deadline === undefined
        ? undefined
        : Math.max(0, Date.parse(parseInstant(spec.deadline) ?? "") - Date.now());
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw aiRuntimeProblem(
        "ai.invocation_timed_out",
        "AIRuntime invocation deadline elapsed",
        "The invocation deadline elapsed before provider dispatch",
        "conflict",
        "after-change",
      );
    }
    const controller = new AbortController();
    const timer =
      remainingMs === undefined
        ? undefined
        : setTimeout(() => controller.abort(), remainingMs);
    try {
      const prompt = modelPrompt(spec.messages);
      const providerFetch = options.networkAccess.createProviderFetch(
        "system.ai-runtime",
        target,
        activeConfig.revisionId,
      );
      const selectedModel =
        model.protocol === "openai-chat"
          ? createOpenAICompatible<string, string, string, string>({
              name: "heptalogos-chat",
              baseURL: gateway.baseUrl,
              ...(apiKey === undefined ? {} : { apiKey }),
              fetch: providerFetch,
            }).chatModel(model.modelIdentifier)
          : createOpenResponses({
              name: "heptalogos-responses",
              url: gateway.baseUrl + "/responses",
              ...(apiKey === undefined ? {} : { apiKey }),
              fetch: providerFetch,
            })(model.modelIdentifier);
      const output = Output.object({
        schema: jsonSchema<Record<string, unknown>>(
          spec.outputSchema as Record<string, unknown>,
        ),
      });
      const system =
        model.protocol === "openai-chat"
          ? chatSystemPrompt(prompt.system, spec.outputSchema)
          : prompt.system;
      const generated = await generateText({
        model: selectedModel,
        messages: prompt.messages,
        ...(system === undefined ? {} : { system }),
        output,
        maxOutputTokens: spec.budget.maxOutputTokens,
        maxRetries: 0,
        abortSignal: controller.signal,
        ...(remainingMs === undefined ? {} : { timeout: remainingMs }),
      });
      if (generated.output === undefined) {
        throw aiRuntimeProblem(
          "ai.output_schema_invalid",
          "Provider returned no structured output",
          "The selected provider did not produce a structured result",
          "unavailable",
          "after-change",
        );
      }
      const validator = compileSchema<CanonicalJsonValue>(spec.outputSchema as object);
      const validation = validator.validate(generated.output);
      if (!validation.ok) {
        throw aiRuntimeProblem(
          "ai.output_schema_invalid",
          "Provider structured output failed schema validation",
          "The returned object did not satisfy the current SchemaRuntime contract",
          "integrity",
        );
      }
      const candidate = snapshotCanonicalJson(validation.value).value;
      const evidenceRefs = await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async () => {
          const evidence = await options.evidence.recordRequired(context, {
            evidenceKind: "ai.generation",
            evidenceContractVersion: "ai-runtime.v1",
            subjectRef: spec.invocationId,
            objectRef: model.modelProfileId,
            factRef: gateway.gatewayProfileId,
            retentionClass: "retained",
            sensitivity: "operational",
          });
          return Object.freeze([
            Object.freeze({
              schemaVersion: 1 as const,
              evidenceId: evidence.evidenceId,
            }),
          ]);
        }),
      );
      const usage = normalizeUsage(generated.usage);
      return Object.freeze({
        schemaVersion: 1 as const,
        invocationId: spec.invocationId,
        modelBindingId: binding.modelBindingId,
        bindingRevision: binding.revision,
        gatewayProfileId: gateway.gatewayProfileId,
        modelProfileId: model.modelProfileId,
        modelProfileGeneration: model.generation,
        modelIdentifier: model.modelIdentifier,
        protocol: model.protocol,
        configurationRevisionId: activeConfig.revisionId,
        candidate,
        ...(usage === undefined ? {} : { usage }),
        lineageContextRef: spec.lineageContextRef,
        evidenceRefs,
      });
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      if (controller.signal.aborted) {
        throw aiRuntimeProblem(
          "ai.invocation_timed_out",
          "AIRuntime invocation timed out",
          "The gateway invocation exceeded its effective deadline",
          "unavailable",
          "after-change",
        );
      }
      throw aiRuntimeProblem(
        "ai.gateway_unavailable",
        "Gateway invocation failed",
        "The selected OpenAI-family gateway invocation did not complete",
        "unavailable",
        "manual",
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return Object.freeze({ invoke });
}
