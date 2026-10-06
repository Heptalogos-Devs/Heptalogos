// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Projects current Heptalogos configuration, model, network, and secret
 * intent into the private Subject OpenClaw runtime shape.
 * @module subject-openclaw-projection
 */

import { join } from "node:path";
import type { RuntimeLocations } from "@heptalogos/bootstrap-runtime";
import {
  type ConfigurationRevision,
  type ConfigurationService,
} from "@heptalogos/configuration";
import {
  createProblemError,
  type InstallationId,
  type SubjectId,
} from "@heptalogos/foundation-contracts";
import type {
  AIRuntimeService,
  GatewayProfile,
  ModelBinding,
  ModelProfile,
  ModelInvocationProtocol,
} from "@heptalogos/ai-runtime";
import { GATEWAY_TRANSPORT_DEFINITION_ID } from "@heptalogos/network-access";
import type { NetworkAccessService } from "@heptalogos/network-access";
import type { SecretMetadata, SecretService } from "@heptalogos/secret";
import {
  DEFAULT_SUBJECT_COGNITION_CONFIG,
  SUBJECT_COGNITION_CONFIGURATION_DEFINITION_ID,
  type SubjectCognitionConfigV1,
} from "@heptalogos/subject";
import { asRecord } from "./value-utils.js";

/** Exact provider evidence selected by the current Product dependency Catalog. */
export const SUBJECT_OPENCLAW_VERSION = "2026.9.1";
/** Fixed provider-private profile for the Product Subject role. */
export const SUBJECT_OPENCLAW_PROFILE = "subject" as const;
/** Product-owned plugin identity for the proposal-only tool surface. */
const SUBJECT_OPENCLAW_PLUGIN_ID = "heptalogos-subject-cognition" as const;
/** Provider id used only inside the generated OpenClaw model configuration. */
export const SUBJECT_OPENCLAW_MODEL_PROVIDER = "heptalogos" as const;
/** OpenClaw's supported environment input for Gateway token authentication. */
const SUBJECT_OPENCLAW_GATEWAY_TOKEN_ENV = "OPENCLAW_GATEWAY_TOKEN" as const;
/** Child-only environment variable referenced by the generated model SecretRef. */
const SUBJECT_OPENCLAW_MODEL_API_KEY_ENV = "HEPTALOGOS_OPENCLAW_MODEL_API_KEY" as const;

const SUBJECT_INHERITED_ENVIRONMENT_KEYS = Object.freeze([
  "Path",
  "PATH",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "NUMBER_OF_PROCESSORS",
  "LANG",
  "LANGUAGE",
  "TERM",
  "COLORTERM",
  "TZ",
] as const);

/** Product-owned paths used by the isolated Subject runtime. */
export interface SubjectOpenClawRuntimePaths {
  readonly data: string;
  readonly configuration: string;
  readonly cache: string;
  readonly run: string;
  readonly state: string;
  readonly workspace: string;
  readonly generatedConfig: string;
}

/** Current Heptalogos intent and resolved non-secret route metadata. */
export interface SubjectOpenClawRuntimeProjection {
  readonly subjectId?: SubjectId;
  readonly cognitionRevision?: ConfigurationRevision;
  readonly cognitionConfig: SubjectCognitionConfigV1;
  readonly transportRevision?: ConfigurationRevision;
  readonly binding?: ModelBinding;
  readonly model?: ModelProfile;
  readonly gateway?: GatewayProfile;
  readonly modelSecretMetadata?: Pick<
    SecretMetadata,
    "secretId" | "state" | "replacedAt"
  >;
}

/** Dependencies needed to build one Subject runtime projection. */
export interface SubjectOpenClawProjectionOptions {
  readonly installationId: InstallationId;
  readonly locations: RuntimeLocations;
  readonly configuration: ConfigurationService;
  readonly aiRuntime: AIRuntimeService;
  readonly networkAccess: NetworkAccessService;
  readonly secret: SecretService;
}

/** In-memory material passed to the child process; secret values never leave this boundary. */
export interface SubjectOpenClawRuntimeMaterial {
  readonly env: NodeJS.ProcessEnv;
  readonly config: string;
  readonly secretValues: readonly string[];
}

const cognitionProblem = (
  problemCode: string,
  title: string,
  detail: string,
  category: "conflict" | "integrity" | "unavailable" | "validation" = "unavailable",
  retryClass: "manual" | "after-change" = "after-change",
): Error => createProblemError({ problemCode, category, retryClass, title, detail });

function subjectScope(subjectId: SubjectId) {
  return Object.freeze({
    schemaVersion: 1 as const,
    resourceKind: "subject",
    resourceId: subjectId,
  });
}

function installationScope(installationId: InstallationId) {
  return Object.freeze({
    schemaVersion: 1 as const,
    resourceKind: "installation",
    resourceId: installationId,
  });
}

/** Derives the Product-owned isolated runtime roots without reading provider state. */
export function subjectOpenClawRuntimePaths(
  locations: RuntimeLocations,
): SubjectOpenClawRuntimePaths {
  const data = join(locations.stateRoot, "subject-openclaw");
  const configuration = join(locations.configRoot, "subject-openclaw");
  const cache = join(locations.cacheRoot, "subject-openclaw");
  const run = join(locations.runRoot, "subject-openclaw");
  return Object.freeze({
    data,
    configuration,
    cache,
    run,
    state: join(data, "state"),
    workspace: join(data, "workspace"),
    generatedConfig: join(configuration, "openclaw.generated.json"),
  });
}

function parsedCognitionConfig(
  revision: ConfigurationRevision | undefined,
): SubjectCognitionConfigV1 {
  if (revision === undefined) return DEFAULT_SUBJECT_COGNITION_CONFIG;
  const value = asRecord(revision.value);
  if (
    value === undefined ||
    value.schemaVersion !== 1 ||
    typeof value.enabled !== "boolean" ||
    typeof value.maxOutputTokens !== "number" ||
    typeof value.runTimeoutMs !== "number" ||
    typeof value.maxContextBytes !== "number" ||
    Object.keys(value).length !== 5
  ) {
    throw cognitionProblem(
      "subject.cognition_configuration_invalid",
      "Subject cognition configuration is invalid",
      "The active subject.cognition.runtime.v1 value is not the current bounded shape",
      "integrity",
      "manual",
    );
  }
  return Object.freeze(value as unknown as SubjectCognitionConfigV1);
}

/** Reads current Product route/configuration intent for one start or cognition attempt. */
export async function readSubjectOpenClawProjection(
  options: SubjectOpenClawProjectionOptions,
  subjectId: SubjectId | undefined,
  requireConfigured: boolean,
): Promise<SubjectOpenClawRuntimeProjection> {
  const cognitionRevision =
    subjectId === undefined
      ? undefined
      : await options.configuration.getEffectiveRevision(
          SUBJECT_COGNITION_CONFIGURATION_DEFINITION_ID,
          subjectScope(subjectId),
        );
  const cognitionConfig = parsedCognitionConfig(cognitionRevision);
  if (requireConfigured && cognitionRevision === undefined) {
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Subject cognition configuration is unavailable",
      "An active subject.cognition.runtime.v1 revision is required",
      "unavailable",
      "after-change",
    );
  }
  if (requireConfigured && !cognitionConfig.enabled) {
    throw cognitionProblem(
      "subject.cognition_disabled",
      "Subject cognition is disabled",
      "The active Subject cognition configuration does not admit OpenClaw runs",
      "conflict",
      "after-change",
    );
  }

  const binding = await options.aiRuntime.getModelBinding("subject.primary");
  if (binding === undefined || !binding.enabled) {
    if (requireConfigured) {
      throw cognitionProblem(
        "subject.primary_unavailable",
        "Subject primary binding is unavailable",
        "The current subject.primary ModelBinding is not usable by OpenClaw",
        "unavailable",
        "after-change",
      );
    }
    return Object.freeze({ subjectId, cognitionRevision, cognitionConfig });
  }
  const model = await options.aiRuntime.getModelProfile(binding.modelProfileId);
  if (model === undefined) {
    if (requireConfigured) {
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject primary model is unavailable",
        "The current subject.primary binding points to no ModelProfile",
        "unavailable",
        "after-change",
      );
    }
    return Object.freeze({ subjectId, cognitionRevision, cognitionConfig });
  }
  const gateway = await options.aiRuntime.getGatewayProfile(model.gatewayProfileId);
  if (gateway === undefined || !gateway.enabled) {
    if (requireConfigured) {
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject primary gateway is unavailable",
        "The current Subject model route does not resolve to an enabled GatewayProfile",
        "unavailable",
        "after-change",
      );
    }
    return Object.freeze({ subjectId, cognitionRevision, cognitionConfig });
  }

  const transportRevision = await options.configuration.getEffectiveRevision(
    GATEWAY_TRANSPORT_DEFINITION_ID,
    installationScope(options.installationId),
  );
  if (transportRevision === undefined) {
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Subject gateway transport configuration is unavailable",
      "An active ai.gateway.transport.v1 revision is required for the projected route",
      "unavailable",
      "after-change",
    );
  }
  try {
    options.networkAccess.authorizeGatewayTarget({
      schemaVersion: 1,
      gatewayProfileId: gateway.gatewayProfileId,
      baseUrl: gateway.baseUrl,
      protocol: model.protocol,
    });
  } catch {
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Subject gateway route is unavailable",
      "NetworkAccess did not authorize the projected Subject model route",
      "unavailable",
      "after-change",
    );
  }

  let modelSecretMetadata:
    Pick<SecretMetadata, "secretId" | "state" | "replacedAt"> | undefined;
  if (gateway.apiTokenSecretRef !== undefined) {
    const metadata = await options.secret.getMetadata(gateway.apiTokenSecretRef);
    if (metadata !== undefined) {
      modelSecretMetadata = Object.freeze({
        secretId: metadata.secretId,
        state: metadata.state,
        ...(metadata.replacedAt === undefined
          ? {}
          : { replacedAt: metadata.replacedAt }),
      });
    }
    if (requireConfigured && (metadata === undefined || metadata.state !== "ACTIVE")) {
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject model credential is unavailable",
        "The projected Subject Gateway SecretRef is not active",
        "unavailable",
        "after-change",
      );
    }
  }

  return Object.freeze({
    subjectId,
    cognitionRevision,
    cognitionConfig,
    transportRevision,
    binding,
    model,
    gateway,
    ...(modelSecretMetadata === undefined ? {} : { modelSecretMetadata }),
  });
}

function modelProviderRef(modelIdentifier: string): string {
  return `${SUBJECT_OPENCLAW_MODEL_PROVIDER}/${modelIdentifier}`;
}

function subjectProcessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SUBJECT_INHERITED_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function openclawApi(
  protocol: ModelInvocationProtocol,
): "openai-completions" | "openai-responses" {
  return protocol === "openai-chat" ? "openai-completions" : "openai-responses";
}

async function resolveModelCredential(
  options: SubjectOpenClawProjectionOptions,
  gateway: GatewayProfile | undefined,
): Promise<string | undefined> {
  if (gateway?.apiTokenSecretRef === undefined) return undefined;
  let material;
  try {
    material = await options.secret.resolve(gateway.apiTokenSecretRef, {
      consumer: "product.subject.openclaw",
      purpose: "ai.gateway.bearer-token",
      resourceRef: {
        schemaVersion: 1,
        resourceKind: "gateway-profile",
        resourceId: gateway.gatewayProfileId,
      },
    });
  } catch {
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Subject model credential is unavailable",
      "The configured Subject Gateway model credential could not be resolved",
      "unavailable",
      "after-change",
    );
  }
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(material.bytes);
    if (value.length === 0) {
      throw new Error("empty credential");
    }
    return value;
  } catch {
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Subject model credential is invalid",
      "The configured Subject Gateway model credential is not valid UTF-8",
      "integrity",
      "manual",
    );
  } finally {
    material.bytes.fill(0);
  }
}

/** Builds the child-only environment and SecretRef-based provider configuration. */
export async function projectSubjectOpenClawRuntime(
  options: SubjectOpenClawProjectionOptions,
  paths: SubjectOpenClawRuntimePaths,
  projection: SubjectOpenClawRuntimeProjection,
  pluginPath: string,
  port: number,
  gatewayToken: string,
): Promise<SubjectOpenClawRuntimeMaterial> {
  const model = projection.model;
  const gateway = projection.gateway;
  const modelCredential = await resolveModelCredential(options, gateway);
  const modelConfig: Record<string, unknown> = {
    baseUrl: gateway?.baseUrl ?? "http://127.0.0.1:1/v1",
    api: openclawApi(model?.protocol ?? "openai-chat"),
    timeoutSeconds: Math.ceil(projection.cognitionConfig.runTimeoutMs / 1_000),
    models: [
      {
        id: model?.modelIdentifier ?? "unconfigured",
        name: model?.modelIdentifier ?? "unconfigured",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: projection.cognitionConfig.maxOutputTokens,
      },
    ],
    ...(modelCredential === undefined
      ? {}
      : {
          apiKey: {
            source: "env",
            provider: "default",
            id: SUBJECT_OPENCLAW_MODEL_API_KEY_ENV,
          },
        }),
  };
  const config = {
    gateway: {
      mode: "local",
      bind: "loopback",
      port,
      auth: {
        mode: "token",
        token: {
          source: "env",
          provider: "default",
          id: SUBJECT_OPENCLAW_GATEWAY_TOKEN_ENV,
        },
      },
      controlUi: { enabled: false },
    },
    agents: {
      defaults: {
        workspace: paths.workspace,
        skipBootstrap: true,
        timeoutSeconds: Math.ceil(projection.cognitionConfig.runTimeoutMs / 1_000),
        model: {
          primary: modelProviderRef(model?.modelIdentifier ?? "unconfigured"),
        },
        models: {
          [modelProviderRef(model?.modelIdentifier ?? "unconfigured")]: {},
        },
      },
    },
    models: {
      mode: "merge",
      providers: {
        [SUBJECT_OPENCLAW_MODEL_PROVIDER]: modelConfig,
      },
    },
    tools: {
      profile: "minimal",
      alsoAllow: [
        "heptalogos_propose_communication",
        "heptalogos_complete_without_communication",
      ],
      deny: [
        "exec",
        "process",
        "browser",
        "web_search",
        "message",
        "gateway",
        "cron",
        "nodes",
      ],
    },
    plugins: {
      enabled: true,
      allow: [SUBJECT_OPENCLAW_PLUGIN_ID],
      load: { paths: [pluginPath] },
      entries: {
        [SUBJECT_OPENCLAW_PLUGIN_ID]: { enabled: true, config: {} },
      },
    },
  };

  const environment: NodeJS.ProcessEnv = {
    ...subjectProcessEnvironment(),
    OPENCLAW_HOME: paths.state,
    OPENCLAW_STATE_DIR: paths.state,
    OPENCLAW_CONFIG_PATH: paths.generatedConfig,
    OPENCLAW_WORKSPACE_DIR: paths.workspace,
    XDG_CACHE_HOME: paths.cache,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_DISABLE_BONJOUR: "1",
    OPENCLAW_EXEC_SHELL_SNAPSHOT: "0",
    OPENCLAW_NO_RESPAWN: "1",
    OPENCLAW_SKIP_CHANNELS: "1",
    NO_COLOR: "1",
    ...(modelCredential === undefined
      ? {}
      : { [SUBJECT_OPENCLAW_MODEL_API_KEY_ENV]: modelCredential }),
  };
  return Object.freeze({
    env: Object.freeze(environment),
    config: JSON.stringify(config),
    secretValues: Object.freeze([
      gatewayToken,
      ...(modelCredential === undefined ? [] : [modelCredential]),
    ]),
  });
}

/** Fingerprint of only the runtime-changing Product projection and generation. */
export function subjectOpenClawRuntimeFingerprint(
  projection: SubjectOpenClawRuntimeProjection,
  productGeneration: string,
): string {
  return JSON.stringify({
    productGeneration,
    subjectId: projection.subjectId,
    cognitionRevisionId: projection.cognitionRevision?.revisionId,
    cognitionConfig: projection.cognitionConfig,
    transportRevisionId: projection.transportRevision?.revisionId,
    binding: projection.binding,
    model: projection.model,
    gateway: projection.gateway,
    modelSecretMetadata: projection.modelSecretMetadata,
  });
}

export { cognitionProblem };
