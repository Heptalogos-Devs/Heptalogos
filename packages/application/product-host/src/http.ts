// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Projects the canonical Management service to the bounded Fastify
 * surface. Route schemas come only from @heptalogos/management.
 * @module http
 */

import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { Type } from "@heptalogos/schema-runtime/typebox";
import {
  MANAGEMENT_API_BASE_PATH,
  MANAGEMENT_CONTRACT_VERSION,
  MANAGEMENT_DISCOVERY_PATH,
  claimRequestSchema,
  claimResponseSchema,
  capabilityGraphSchema,
  hostReadModelSchema,
  loginRequestSchema,
  loginResponseSchema,
  managementDiscoverySchema,
  managementProblemSchema,
  productStateSchema,
  readinessSchema,
  runtimeGraphSchema,
  systemStatusSchema,
  systemActionDefinitionSchema,
  systemActionExecuteRequestSchema,
  systemActionExecuteResultSchema,
  systemActionRequestSchema,
  systemChangePlanSchema,
  type SystemActionExecuteRequest,
  type SystemActionRequest,
  type ClaimRequest,
  type LoginRequest,
  type ManagementProblemDetails,
  type ManagementService,
} from "@heptalogos/management";
import {
  registerSubjectChatRoutes,
  type SubjectChatHttpOptions,
} from "./subject-chat-http.js";
import {
  invalidInputProblem,
  managementHttpStatus,
  managementProblem,
  toManagementProblemDetails,
} from "@heptalogos/management";
import { assertContractHeader, tokenFromRequest } from "./http-auth.js";
import {
  DEFAULT_MANAGEMENT_HTTP_ADMISSION_CONFIG,
  type ManagementHttpAdmissionConfigV1,
} from "./http-admission.js";

/** Creates a canonical Problem response for the adopted rate-limit plugin. */
function rateLimitResponse(): ManagementProblemDetails {
  return toManagementProblemDetails(
    managementProblem(
      "management.rate_limited",
      "Management request rate limit exceeded",
      "The Management authentication admission limit was exceeded",
      "conflict",
      "after-change",
    ),
  );
}

async function authenticate(
  service: ManagementService,
  request: FastifyRequest,
): Promise<void> {
  assertContractHeader(request);
  await service.authenticate(tokenFromRequest(request));
}

/** Supplies Product Host-local publication cleanup for successful claim use. */
export interface ManagementHttpOptions {
  readonly onAdministratorClaimed?: () => Promise<void>;
  /** Effective installation-scoped HTTP admission configuration. */
  readonly admission?: ManagementHttpAdmissionConfigV1;
  /** Optional current Messaging/Subject protocol routes on the same listener. */
  readonly subjectChat?: SubjectChatHttpOptions;
}

/** Creates the Management HTTP app without starting its listener. */
export async function createManagementHttpApp(
  service: ManagementService,
  options: ManagementHttpOptions = {},
): Promise<FastifyInstance> {
  const admission = options.admission ?? DEFAULT_MANAGEMENT_HTTP_ADMISSION_CONFIG;
  const app = fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: admission.bodyLimitBytes,
    exposeHeadRoutes: false,
    return503OnClosing: true,
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Heptalogos Management API",
        version: MANAGEMENT_CONTRACT_VERSION,
      },
      servers: [{ url: "http://127.0.0.1" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "opaque",
          },
        },
      },
    },
    hideUntagged: false,
    exposeHeadRoutes: false,
  });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    const errorRecord =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : undefined;
    const validation = errorRecord?.validation !== undefined;
    const statusCode =
      typeof errorRecord?.statusCode === "number" ? errorRecord.statusCode : undefined;
    const rateLimited =
      statusCode === 429 || errorRecord?.problemCode === "management.rate_limited";
    const projected = validation
      ? toManagementProblemDetails(invalidInputProblem(), request.url)
      : rateLimited
        ? rateLimitResponse()
        : toManagementProblemDetails(error, request.url);
    void reply
      .code(
        typeof projected.status === "number"
          ? projected.status
          : (statusCode ?? managementHttpStatus("management.internal")),
      )
      .type("application/problem+json")
      .send(projected);
  });

  app.get(
    MANAGEMENT_DISCOVERY_PATH,
    {
      schema: {
        operationId: "getManagementDiscovery",
        summary: "Discover the current Management contract",
        response: { 200: managementDiscoverySchema },
      },
    },
    async () => service.getDiscovery(),
  );

  app.post(
    MANAGEMENT_API_BASE_PATH + "/bootstrap/claim",
    {
      config: {
        rateLimit: {
          max: admission.claimRateLimit.max,
          timeWindow: admission.claimRateLimit.windowMs,
          errorResponseBuilder: () => rateLimitResponse(),
        },
      },
      schema: {
        operationId: "claimFirstAdministrator",
        summary: "Claim the first Administrator",
        body: claimRequestSchema,
        response: {
          201: claimResponseSchema,
          400: managementProblemSchema,
          409: managementProblemSchema,
          429: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
      },
    },
    async (request, reply) => {
      assertContractHeader(request);
      const body = request.body as ClaimRequest;
      const result = await service.claimFirstAdministrator(
        body.claimId,
        body.claimSecret,
        body.password,
      );
      if (options.onAdministratorClaimed !== undefined) {
        await options.onAdministratorClaimed().catch(() => undefined);
      }
      return reply.code(201).send(result);
    },
  );

  app.post(
    MANAGEMENT_API_BASE_PATH + "/session",
    {
      config: {
        rateLimit: {
          max: admission.loginRateLimit.max,
          timeWindow: admission.loginRateLimit.windowMs,
          errorResponseBuilder: () => rateLimitResponse(),
        },
      },
      schema: {
        operationId: "createManagementSession",
        summary: "Create a Management session",
        body: loginRequestSchema,
        response: {
          200: loginResponseSchema,
          401: managementProblemSchema,
          429: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
      },
    },
    async (request) => {
      assertContractHeader(request);
      const body = request.body as LoginRequest;
      return service.login(body.password);
    },
  );

  app.delete(
    MANAGEMENT_API_BASE_PATH + "/session/current",
    {
      schema: {
        operationId: "revokeCurrentManagementSession",
        summary: "Revoke the current Management session",
        response: {
          204: { type: "null" },
          401: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      assertContractHeader(request);
      await service.logout(tokenFromRequest(request));
      return reply.code(204).send();
    },
  );

  app.get(
    MANAGEMENT_API_BASE_PATH + "/system/status",
    {
      schema: {
        operationId: "getSystemStatus",
        response: {
          200: systemStatusSchema,
          401: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async () => service.getSystemStatus(),
  );

  app.get(
    MANAGEMENT_API_BASE_PATH + "/host",
    {
      schema: {
        operationId: "getHost",
        response: {
          200: hostReadModelSchema,
          401: managementProblemSchema,
          426: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async () => service.getHost(),
  );

  app.get(
    MANAGEMENT_API_BASE_PATH + "/runtime/graph",
    {
      schema: {
        operationId: "getRuntimeGraph",
        response: {
          200: runtimeGraphSchema,
          401: managementProblemSchema,
          426: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async () => service.getRuntimeGraph(),
  );

  app.get(
    MANAGEMENT_API_BASE_PATH + "/capabilities",
    {
      schema: {
        operationId: "getCapabilityGraph",
        response: {
          200: capabilityGraphSchema,
          401: managementProblemSchema,
          426: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async () => service.getCapabilityGraph(),
  );

  // Intentional duplication: these public read routes keep their operation,
  // response, and authorization contracts adjacent to each endpoint.
  /* jscpd:ignore-start */
  app.get(
    MANAGEMENT_API_BASE_PATH + "/readiness",
    {
      schema: {
        operationId: "getReadiness",
        response: {
          200: readinessSchema,
          401: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async () => service.getReadiness(),
  );
  /* jscpd:ignore-end */

  app.get(
    MANAGEMENT_API_BASE_PATH + "/actions",
    {
      schema: {
        operationId: "getSystemActionCatalog",
        summary: "Read the current SystemAction catalog",
        response: {
          200: Type.Array(systemActionDefinitionSchema),
          401: managementProblemSchema,
          426: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async () => service.getSystemActionCatalog(),
  );

  app.post(
    MANAGEMENT_API_BASE_PATH + "/actions/plan",
    {
      schema: {
        operationId: "planSystemAction",
        summary: "Create a side-effect-free current SystemAction plan",
        body: systemActionRequestSchema,
        response: {
          200: systemChangePlanSchema,
          400: managementProblemSchema,
          401: managementProblemSchema,
          409: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async (request) => service.planAction(request.body as SystemActionRequest),
  );

  // Intentional duplication: plan and execute are distinct Management
  // operations with different request/response and authorization semantics.
  /* jscpd:ignore-start */
  app.post(
    MANAGEMENT_API_BASE_PATH + "/actions/execute",
    {
      schema: {
        operationId: "executeSystemAction",
        summary: "Reauthenticate and execute one exact SystemAction plan",
        body: systemActionExecuteRequestSchema,
        response: {
          200: systemActionExecuteResultSchema,
          400: managementProblemSchema,
          401: managementProblemSchema,
          409: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async (request) =>
      service.executeAction(
        tokenFromRequest(request),
        request.body as SystemActionExecuteRequest,
      ),
  );
  /* jscpd:ignore-end */

  // Intentional duplication: this public read route retains its own
  // Product-state contract instead of hiding it behind a route factory.
  /* jscpd:ignore-start */
  app.get(
    MANAGEMENT_API_BASE_PATH + "/product/state",
    {
      schema: {
        operationId: "getProductState",
        summary: "Read current Product prerequisite state",
        response: {
          200: productStateSchema,
          401: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
      preHandler: async (request) => authenticate(service, request),
    },
    async () => service.getProductState(),
  );
  /* jscpd:ignore-end */

  if (options.subjectChat !== undefined) {
    registerSubjectChatRoutes(app, options.subjectChat);
  }

  return app;
}
