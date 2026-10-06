// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Projects the current Messaging Subject Chat protocol onto the Host listener.
 * @module subject-chat-http
 */

import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import { Type } from "@heptalogos/schema-runtime/typebox";
import {
  MANAGEMENT_CONTRACT_VERSION,
  managementProblem,
  managementProblemSchema,
  toManagementProblemDetails,
} from "@heptalogos/management";
import { SUBJECT_CHAT_PLATFORM_ID, type MessagingService } from "@heptalogos/messaging";
import { assertContractHeader, tokenFromRequest } from "./http-auth.js";
import { DEFAULT_MANAGEMENT_HTTP_ADMISSION_CONFIG } from "./http-admission.js";

const SUBJECT_CHAT_BASE_PATH = "/subject-chat/v1" as const;

const messageSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  messageId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  conversationId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  sequence: Type.Integer({ minimum: 1 }),
  direction: Type.Union([Type.Literal("INBOUND"), Type.Literal("OUTBOUND")]),
  senderKind: Type.Union([Type.Literal("ADMINISTRATOR"), Type.Literal("SUBJECT")]),
  senderAccountId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  recipientKind: Type.Union([Type.Literal("ADMINISTRATOR"), Type.Literal("SUBJECT")]),
  recipientAccountId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  text: Type.String({ minLength: 1, maxLength: 65_536 }),
  clientMessageId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  acceptedInputDigest: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
  causedByCommunicationCommitId: Type.Optional(
    Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  ),
  createdAt: Type.String(),
  lineageContextRef: Type.Unknown(),
});

const conversationSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  conversationId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  installationId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  platformId: Type.String({ const: SUBJECT_CHAT_PLATFORM_ID }),
  administratorId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  administratorAccountId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  subjectId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  subjectAccountId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  lastSequence: Type.Integer({ minimum: 0 }),
  createdAt: Type.String(),
  lineageContextRef: Type.Unknown(),
});

const acceptedSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  status: Type.Union([Type.Literal("ACCEPTED"), Type.Literal("EXISTING")]),
  message: messageSchema,
});

const pageSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  conversationId: Type.String({ pattern: "^[0-9a-fA-F-]{36}$" }),
  messages: Type.Array(messageSchema),
  nextCursor: Type.Optional(Type.String({ minLength: 1 })),
});

const inboundRequestSchema = Type.Object(
  {
    clientMessageId: Type.String({ minLength: 1, maxLength: 256 }),
    text: Type.String({ minLength: 1, maxLength: 65_536 }),
  },
  { additionalProperties: false },
);

const listQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

/** Current transport dependencies; Management remains the sole session owner. */
export interface SubjectChatHttpOptions {
  readonly service: MessagingService;
  readonly authenticate: (sessionToken: string) => Promise<string>;
}

async function administratorId(
  options: SubjectChatHttpOptions,
  request: FastifyRequest,
): Promise<string> {
  assertContractHeader(request);
  return options.authenticate(tokenFromRequest(request));
}

/** Registers Subject Chat routes on an already configured Fastify listener. */
export function registerSubjectChatRoutes(
  app: FastifyInstance,
  options: SubjectChatHttpOptions,
): void {
  app.post(
    SUBJECT_CHAT_BASE_PATH + "/messages",
    {
      schema: {
        operationId: "sendSubjectChatMessage",
        summary: "Accept one idempotent Administrator message",
        body: inboundRequestSchema,
        response: {
          200: acceptedSchema,
          400: managementProblemSchema,
          401: managementProblemSchema,
          409: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const adminId = await administratorId(options, request);
      const body = request.body as { clientMessageId: string; text: string };
      return options.service.acceptInbound({
        administratorId: adminId,
        clientMessageId: body.clientMessageId,
        text: body.text,
      });
    },
  );

  app.get(
    SUBJECT_CHAT_BASE_PATH + "/messages",
    {
      schema: {
        operationId: "listSubjectChatMessages",
        summary: "Read canonical Subject Chat messages",
        querystring: listQuerySchema,
        response: {
          200: pageSchema,
          400: managementProblemSchema,
          401: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const adminId = await administratorId(options, request);
      const query = request.query as { cursor?: string; limit?: number };
      return options.service.listMessages({
        administratorId: adminId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
    },
  );

  app.get(
    SUBJECT_CHAT_BASE_PATH + "/conversation",
    {
      schema: {
        operationId: "getSubjectChatConversation",
        summary: "Read the built-in Subject Chat conversation",
        response: {
          200: conversationSchema,
          401: managementProblemSchema,
          404: managementProblemSchema,
          426: managementProblemSchema,
          503: managementProblemSchema,
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const adminId = await administratorId(options, request);
      const conversation =
        await options.service.getConversationForAdministrator(adminId);
      if (conversation === undefined) {
        throw managementProblem(
          "messaging.conversation_not_ready",
          "Subject Chat is not initialized",
          "The current Administrator has no built-in Subject Chat conversation",
          "unavailable",
          "after-change",
        );
      }
      return conversation;
    },
  );
}

/** Creates a schema-only Subject Chat app for the separate OpenAPI artifact. */
export async function createSubjectChatHttpApp(
  options: SubjectChatHttpOptions,
): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: DEFAULT_MANAGEMENT_HTTP_ADMISSION_CONFIG.bodyLimitBytes,
    exposeHeadRoutes: false,
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Heptalogos Subject Chat API",
        version: MANAGEMENT_CONTRACT_VERSION,
      },
      servers: [{ url: "http://127.0.0.1" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque" },
        },
      },
    },
    hideUntagged: false,
    exposeHeadRoutes: false,
  });
  app.setErrorHandler((error, request, reply) => {
    const projected = toManagementProblemDetails(error, request.url);
    void reply.code(projected.status).type("application/problem+json").send(projected);
  });
  registerSubjectChatRoutes(app, options);
  return app;
}
