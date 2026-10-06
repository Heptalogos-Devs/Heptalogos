// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements bounded gateway NetworkAccess over Node global fetch, enforcing
 * active transport configuration before AI protocol dispatch.
 * @module service
 */

import { parseInstant, type Instant } from "@heptalogos/foundation-contracts";
import type {
  ConfigurationRevision,
  ConfigurationService,
} from "@heptalogos/configuration";
import {
  GATEWAY_TRANSPORT_DEFINITION_ID,
  type GatewayTransportConfigV1,
} from "./contracts.js";
import {
  type GatewayNetworkTarget,
  type NetworkAccessPolicy,
  type NetworkAccessService,
  type NetworkAccessServiceOptions,
} from "./contracts.js";
import { networkProblem } from "./problems.js";

const POLICY: NetworkAccessPolicy = Object.freeze({
  schemaVersion: 1,
  method: "POST",
  redirects: "DENY",
});

function configurationScope(installationId: string) {
  return Object.freeze({
    schemaVersion: 1 as const,
    resourceKind: "installation",
    resourceId: installationId,
  });
}

function configValue(
  configuration: ConfigurationService,
  installationId: string,
): Promise<ConfigurationRevision | undefined> {
  return configuration.getEffectiveRevision(
    GATEWAY_TRANSPORT_DEFINITION_ID,
    configurationScope(installationId),
  );
}

function transportConfig(revision: ConfigurationRevision): GatewayTransportConfigV1 {
  return revision.value as unknown as GatewayTransportConfigV1;
}

function requestUrl(input: Parameters<typeof fetch>[0] | URL): URL {
  try {
    if (input instanceof URL) return new URL(input.href);
    if (typeof input === "string") return new URL(input);
    return new URL(input.url);
  } catch {
    throw networkProblem(
      "network.unauthorized_destination",
      "Network destination is invalid",
      "The request destination could not be parsed",
      "validation",
    );
  }
}

function targetBaseUrl(target: GatewayNetworkTarget): URL {
  if (
    target.schemaVersion !== 1 ||
    typeof target.gatewayProfileId !== "string" ||
    target.gatewayProfileId.trim().length === 0
  ) {
    throw networkProblem(
      "network.unauthorized_destination",
      "Network destination is not allowed",
      "The selected GatewayProfile destination is invalid",
      "validation",
    );
  }
  let base: URL;
  try {
    base = new URL(target.baseUrl);
  } catch {
    throw networkProblem(
      "network.unauthorized_destination",
      "Network destination is not allowed",
      "The selected GatewayProfile base URL is invalid",
      "validation",
    );
  }
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    throw networkProblem(
      "network.unauthorized_destination",
      "Network destination is not allowed",
      "The selected GatewayProfile base URL must be an absolute credential-free HTTP URL",
      "validation",
    );
  }
  const host = base.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (base.protocol === "http:" && !loopback) {
    throw networkProblem(
      "network.unauthorized_destination",
      "Network destination is not allowed",
      "Plain HTTP is permitted only for literal loopback GatewayProfiles",
      "conflict",
      "after-change",
    );
  }
  if (base.pathname !== "/" && base.pathname.endsWith("/")) {
    base.pathname = base.pathname.replace(/\/+$/u, "");
  }
  if (base.pathname === "/") base.pathname = "";
  return base;
}

function endpointPath(target: GatewayNetworkTarget, base: URL): string {
  const suffix = target.protocol === "openai-chat" ? "/chat/completions" : "/responses";
  return (base.pathname === "" ? "" : base.pathname) + suffix;
}

function assertDestination(target: GatewayNetworkTarget, url: URL): void {
  const base = targetBaseUrl(target);
  if (url.origin !== base.origin || url.pathname !== endpointPath(target, base)) {
    throw networkProblem(
      "network.unauthorized_destination",
      "Network destination is not allowed",
      "The request must target the selected GatewayProfile origin and protocol endpoint",
      "conflict",
      "after-change",
    );
  }
}

function assertRequester(requester: string): void {
  if (requester !== "system.ai-runtime") {
    throw networkProblem(
      "network.unauthorized_requester",
      "Network requester is not allowed",
      "Only the current AIRuntime requester may use a GatewayProfile route",
      "conflict",
      "after-change",
    );
  }
}

function headerValue(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? undefined;
}

function contentLength(headers: Headers): number | undefined {
  const value = headerValue(headers, "content-length");
  if (value === undefined || !/^[0-9]+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function boundedBody(response: Response, budget: number): Promise<Uint8Array> {
  const declared = contentLength(response.headers);
  if (declared !== undefined && declared > budget) {
    throw networkProblem(
      "network.response_budget_exceeded",
      "Network response exceeds its budget",
      "The provider response content length exceeds the active response budget",
      "conflict",
      "after-change",
    );
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > budget) {
        await reader.cancel();
        throw networkProblem(
          "network.response_budget_exceeded",
          "Network response exceeds its budget",
          "The provider response exceeded the active response budget while streaming",
          "conflict",
          "after-change",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function deadlineMilliseconds(deadline: Instant | undefined): number | undefined {
  if (deadline === undefined) return undefined;
  const parsed = parseInstant(deadline);
  if (parsed === undefined) {
    throw networkProblem(
      "network.invalid_deadline",
      "Network deadline is invalid",
      "deadline must be a canonical Instant",
      "validation",
    );
  }
  return Math.max(0, Date.parse(parsed) - Date.now());
}

/** Creates the current NetworkAccess service. */
export function createNetworkAccessService(
  options: NetworkAccessServiceOptions,
): NetworkAccessService {
  const transport = options.transport ?? fetch;
  const service: NetworkAccessService = {
    async getDiagnostics() {
      const revision = await configValue(options.configuration, options.installationId);
      return Object.freeze({
        schemaVersion: 1 as const,
        policy: POLICY,
        configured: revision !== undefined,
        ...(revision === undefined
          ? { blocker: "configuration" as const }
          : {
              ...transportConfig(revision),
            }),
      });
    },
    authorizeGatewayTarget(target) {
      targetBaseUrl(target);
      if (target.protocol !== "openai-chat" && target.protocol !== "openai-responses") {
        throw networkProblem(
          "network.unauthorized_destination",
          "Network protocol is not allowed",
          "Only the current OpenAI-family Chat and Responses protocol routes are admitted",
          "validation",
        );
      }
    },
    async request(
      requester,
      target,
      expectedConfigurationRevisionId,
      input,
      init,
      deadline,
    ) {
      assertRequester(requester);
      service.authorizeGatewayTarget(target);
      const current = options.execution.current();
      if (current === undefined) {
        throw networkProblem(
          "network.activity_required",
          "Network request requires an Activity",
          "Controlled gateway traffic must carry current execution lineage",
          "conflict",
          "after-change",
        );
      }
      const lineageContextRef = options.execution.createLineageContextRef();
      const revision = await configValue(options.configuration, options.installationId);
      if (revision === undefined) {
        throw networkProblem(
          "network.configuration_unavailable",
          "Network transport is not configured",
          "An active gateway transport ConfigurationRevision is required",
          "conflict",
          "after-change",
        );
      }
      if (revision.revisionId !== expectedConfigurationRevisionId) {
        throw networkProblem(
          "network.configuration_unavailable",
          "Network transport configuration is stale",
          "The active gateway transport ConfigurationRevision changed before dispatch",
          "conflict",
          "after-change",
        );
      }
      const config = transportConfig(revision);
      const request = new Request(input, init);
      const url = requestUrl(request);
      assertDestination(target, url);
      if (request.method.toUpperCase() !== POLICY.method) {
        throw networkProblem(
          "network.unauthorized_method",
          "Network method is not allowed",
          "The current gateway transport policy admits POST only",
          "conflict",
          "after-change",
        );
      }
      const body =
        request.body === null
          ? new Uint8Array()
          : new Uint8Array(await request.clone().arrayBuffer());
      if (body.byteLength > config.requestBodyBudgetBytes) {
        throw networkProblem(
          "network.request_budget_exceeded",
          "Network request exceeds its budget",
          "The provider request body exceeds the active request budget",
          "conflict",
          "after-change",
        );
      }
      if (headerValue(request.headers, "cookie") !== undefined) {
        throw networkProblem(
          "network.sensitive_header_denied",
          "Sensitive header is not allowed",
          "Cookie headers are not admitted on the current gateway route",
          "conflict",
          "after-change",
        );
      }
      const deadlineMs = deadlineMilliseconds(deadline);
      const timeoutMs =
        deadlineMs === undefined
          ? config.timeoutMs
          : Math.min(config.timeoutMs, deadlineMs);
      if (timeoutMs <= 0) {
        throw networkProblem(
          "network.timeout",
          "Network request deadline has elapsed",
          "The effective provider request deadline has already elapsed",
          "conflict",
          "after-change",
        );
      }
      const timeoutController = new AbortController();
      const signal = AbortSignal.any([request.signal, timeoutController.signal]);
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      let timedOut = false;
      try {
        const response = await transport(
          new Request(request, { redirect: "manual", signal }),
        );
        if (response.status >= 300 && response.status < 400) {
          throw networkProblem(
            "network.redirect_denied",
            "Network redirect is denied",
            "The current NetworkAccess policy does not follow redirects",
            "conflict",
            "after-change",
          );
        }
        const responseBody = await boundedBody(
          response,
          config.responseBodyBudgetBytes,
        );
        return Object.freeze({
          statusCode: response.status,
          finalDestination: url,
          headers: Object.freeze(
            [...response.headers].map(([name, value]) =>
              Object.freeze({ name, value }),
            ),
          ),
          body: responseBody,
          bytesRead: responseBody.byteLength,
          lineageContextRef,
        });
      } catch (error) {
        timedOut = timeoutController.signal.aborted;
        if (error instanceof Error && "problem" in error) throw error;
        if (timedOut) {
          throw networkProblem(
            "network.timeout",
            "Network request timed out",
            "The provider request exceeded the active transport deadline",
            "unavailable",
            "after-change",
          );
        }
        if (request.signal.aborted) {
          throw networkProblem(
            "network.aborted",
            "Network request was aborted",
            "The provider request was cancelled by its caller",
            "conflict",
            "after-change",
          );
        }
        throw networkProblem(
          "network.transport_unavailable",
          "Network transport is unavailable",
          "The controlled provider transport did not complete",
          "unavailable",
          "manual",
        );
      } finally {
        clearTimeout(timer);
      }
    },
    createProviderFetch(requester, target, expectedConfigurationRevisionId) {
      return async (input, init) => {
        const response = await service.request(
          requester,
          target,
          expectedConfigurationRevisionId,
          input,
          init,
        );
        return new Response(response.body, {
          status: response.statusCode,
          headers: Object.fromEntries(
            response.headers.map((header) => [header.name, header.value]),
          ),
        });
      };
    },
  };
  return Object.freeze(service);
}
