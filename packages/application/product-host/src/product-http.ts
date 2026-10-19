// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Management transport; canonical schemas generate the installed client.
 * @module product-http
 */
import fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";
import {
  type ManagementAuthentication,
  type ProductManagement,
  claimRequestSchema,
  claimResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  managementProblemSchema,
  toManagementProblemDetails,
  invalidInputProblem,
  managementProblem,
  productStatusSchema,
  productDiscoverySchema,
  productConfigurationSchema,
  productSettingsSchema,
  configureProductSchema,
  type ClaimRequest,
  type LoginRequest,
  type ProductSettings,
  type CreateProductSubject,
  managedSubjectSchema,
  createProductSubjectSchema,
  bindProductSubjectSchema,
  boundSubjectSchema,
} from "@heptalogos/management";
import { Type } from "@heptalogos/schema-runtime/typebox";
import { tokenFromRequest } from "./http-auth.js";
import { registerOperatorHttp, type createOperatorOperations } from "./operator.js";
import { registerCalendarMomentHttp, type createCalendarMomentOperations } from "./calendar-moment.js";
import { registerPursuitHttp, type PursuitHttpOptions } from "./pursuit-http.js";
import { registerWorldHttp, type WorldHttpOptions } from "./world-http.js";
import { registerNarrativeHttp, type NarrativeHttpOptions } from "./narrative-http.js";
import { registerWorldOpportunityHttp } from "./world-opportunity-http.js";
import { registerLifeReadHttp } from "./life-read-http.js";
import { registerGatewayHttp, type GatewayHttpOptions } from "./gateway-http.js";
import { registerReactorHttp, type ReactorHttpOptions } from "./reactor-http.js";

async function withRequestSignal<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const aborted = () => controller.abort();
  const closed = () => {
    if (!reply.raw.writableFinished) aborted();
  };
  request.raw.once("aborted", aborted);
  reply.raw.once("close", closed);
  if (request.raw.aborted) aborted();
  try {
    return await operation(controller.signal);
  } finally {
    request.raw.off("aborted", aborted);
    reply.raw.off("close", closed);
  }
}

/** Configures the one current Management listener, without starting any agent. */
export interface ProductHttpOptions {
  readonly operator?: ReturnType<typeof createOperatorOperations>;
  readonly calendarMoment?: ReturnType<typeof createCalendarMomentOperations>;
  readonly authentication: ManagementAuthentication;
  readonly product: ProductManagement;
  readonly identity: { readonly installationId: string; readonly bootId: string };
  readonly onAdministratorClaimed: () => Promise<void>;
  readonly gateway?: GatewayHttpOptions;
  readonly pursuit?: PursuitHttpOptions;
  readonly world?: WorldHttpOptions;
  readonly narrative?: NarrativeHttpOptions;
  readonly reactor?: ReactorHttpOptions;
  readonly worldOpportunity?: Parameters<typeof registerWorldOpportunityHttp>[1];
}
/** Builds a loopback-only, non-model-dependent Management API. */
export async function createProductHttpApp(options: ProductHttpOptions) {
  const app = fastify({
    logger: false,
    ajv: {
      customOptions: {
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
      },
    },
    trustProxy: false,
    bodyLimit: 65_536,
    requestTimeout: 15_000,
    connectionTimeout: 15_000,
    exposeHeadRoutes: false,
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Heptalogos Management", version: "1.0.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
          gatewayService: { type: "http", scheme: "bearer" },
        },
      },
    },
  });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, request, reply) => {
    const record =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : undefined;
    const problem = toManagementProblemDetails(
      record?.statusCode === 429
        ? managementProblem(
            "management.rate_limited",
            "Too many authentication attempts",
            "Wait before trying again",
            "conflict",
            "after-change",
          )
        : record?.validation
          ? invalidInputProblem()
          : error,
      request.url,
    );
    return reply
      .code(typeof problem.status === "number" ? problem.status : 500)
      .type("application/problem+json")
      .send(problem);
  });
  const authenticate = async (request: FastifyRequest) => {
    await options.authentication.authenticate(tokenFromRequest(request));
  };
  const errors = {
    400: managementProblemSchema,
    401: managementProblemSchema,
    403: managementProblemSchema,
    404: managementProblemSchema,
    409: managementProblemSchema,
    503: managementProblemSchema,
    500: managementProblemSchema,
  };
  const security = [{ bearerAuth: [] }];
  registerOperatorHttp(
    app,
    (token) => options.authentication.authenticate(token ?? "").then(() => undefined),
    options.operator,
  );
  registerCalendarMomentHttp(app,
    (token) => options.authentication.authenticate(token ?? "").then(() => undefined),
    options.calendarMoment,
  );
  app.get(
    "/.well-known/heptalogos-management",
    {
      schema: {
        operationId: "getManagementDiscovery",
        response: { 200: productDiscoverySchema },
      },
    },
    async () => ({
      ...options.identity,
      apiBasePath: "/v1",
      contractVersion: "management.v1",
    }),
  );
  app.get("/readyz", { schema: { hide: true } }, async () => ({
    management: "available",
  }));
  app.get(
    "/v1/status",
    {
      preHandler: authenticate,
      schema: {
        operationId: "getProductStatus",
        security,
        response: { 200: productStatusSchema, ...errors },
      },
    },
    async (request, reply) =>
      withRequestSignal(request, reply, (signal) => options.product.status(signal)),
  );
  app.post(
    "/v1/bootstrap/claim",
    {
      config: { rateLimit: { max: 5, timeWindow: 60_000 } },
      schema: {
        operationId: "claimFirstAdministrator",
        body: claimRequestSchema,
        response: { 201: claimResponseSchema, ...errors, 429: managementProblemSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as ClaimRequest;
      const result = await options.authentication.claimFirstAdministrator(
        body.claimId,
        body.claimSecret,
        body.password,
      );
      await options.onAdministratorClaimed();
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/v1/session",
    {
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: {
        operationId: "createManagementSession",
        body: loginRequestSchema,
        response: { 200: loginResponseSchema, ...errors, 429: managementProblemSchema },
      },
    },
    async (request) =>
      options.authentication.login((request.body as LoginRequest).password),
  );
  app.delete(
    "/v1/session/current",
    {
      schema: {
        operationId: "revokeCurrentManagementSession",
        security,
        response: { 204: Type.Null(), ...errors },
      },
    },
    async (request, reply) => {
      await options.authentication.logout(tokenFromRequest(request));
      return reply.code(204).send();
    },
  );
  app.get(
    "/v1/config/describe",
    {
      preHandler: authenticate,
      schema: {
        operationId: "describeProductConfiguration",
        security,
        response: { 200: Type.Object({ settings: Type.Unknown() }), ...errors },
      },
    },
    async () => ({ settings: productSettingsSchema }),
  );
  app.get(
    "/v1/config",
    {
      preHandler: authenticate,
      schema: {
        operationId: "getProductConfiguration",
        security,
        response: { 200: productConfigurationSchema, ...errors },
      },
    },
    async () => options.product.configuration(),
  );
  app.post(
    "/v1/config/check",
    {
      preHandler: authenticate,
      schema: {
        operationId: "checkProductConfiguration",
        security,
        body: productSettingsSchema,
        response: { 200: productSettingsSchema, ...errors },
      },
    },
    async (request) => options.product.check(request.body),
  );
  app.put(
    "/v1/config",
    {
      preHandler: authenticate,
      schema: {
        operationId: "configureProduct",
        security,
        body: configureProductSchema,
        response: {
          200: productConfigurationSchema,
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        settings: ProductSettings;
        expectedRevision: string | null;
      };
      return withRequestSignal(request, reply, async (signal) => {
        const configuration = await options.product.configure(
          body.settings,
          body.expectedRevision,
          signal,
        );
        return configuration;
      });
    },
  );
  app.get(
    "/v1/subject",
    {
      preHandler: authenticate,
      schema: {
        operationId: "getBoundSubject",
        security,
        response: { 200: boundSubjectSchema, ...errors },
      },
    },
    async (request, reply) =>
      withRequestSignal(request, reply, (signal) => options.product.subject(signal)),
  );
  app.put(
    "/v1/subject",
    {
      preHandler: authenticate,
      schema: {
        operationId: "bindProductSubject",
        security,
        body: bindProductSubjectSchema,
        response: { 200: productConfigurationSchema, ...errors },
      },
    },
    async (request, reply) => {
      const body = request.body as { subjectId: string; expectedRevision: string };
      return withRequestSignal(request, reply, (signal) =>
        options.product.bindSubject(body.subjectId, body.expectedRevision, signal),
      );
    },
  );
  app.post(
    "/v1/subjects",
    {
      preHandler: authenticate,
      schema: {
        operationId: "createProductSubject",
        security,
        body: createProductSubjectSchema,
        response: { 201: managedSubjectSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          await withRequestSignal(request, reply, (signal) =>
            options.product.createSubject(request.body as CreateProductSubject, signal),
          ),
        ),
  );
  registerGatewayHttp(app, options.gateway);
  registerLifeReadHttp(app, options.gateway);
  registerPursuitHttp(app, options.pursuit);
  registerWorldHttp(app, options.world);
  registerNarrativeHttp(app, options.narrative);
  registerReactorHttp(app, options.reactor);
  const unavailable = async (): Promise<never> => {
    throw managementProblem(
      "world.unconfigured",
      "World opportunity is not configured",
      "Use the actual current Product Host composition",
      "unavailable",
    );
  };
  registerWorldOpportunityHttp(
    app,
    options.worldOpportunity ?? {
      authenticate: unavailable,
      currentSubject: unavailable,
      runMutation: unavailable,
      advance: unavailable,
    },
  );
  return app;
}

/** Drains active HTTP requests briefly, then cancels withheld bodies and closes their sockets. */
export async function closeProductHttpApp(app: FastifyInstance): Promise<void> {
  const closing = app.close();
  const force = setTimeout(() => app.server.closeAllConnections(), 5_000);
  force.unref();
  try {
    await closing;
  } finally {
    clearTimeout(force);
  }
}
