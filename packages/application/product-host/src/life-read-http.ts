// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Exposes exact Activity reading through the existing service authority and Life owner.
 * @module life-read-http
 */
import type { FastifyInstance } from "fastify";
import { Type } from "@heptalogos/schema-runtime/typebox";
import { readActivitySchema, activitySchema } from "@heptalogos/subject";
import { managementProblem, managementProblemSchema } from "@heptalogos/management";
import type { GatewayHttpOptions } from "./gateway-http.js";
import { tokenFromRequest } from "./http-auth.js";
/** Registers schema-generated read access; a service token never changes the current Subject binding. */
export function registerLifeReadHttp(
  app: FastifyInstance,
  options?: GatewayHttpOptions,
) {
  const owners = () =>
    options ??
    (() => {
      throw managementProblem(
        "gateway.unconfigured",
        "Life is not configured",
        "Configure the current gateway binding",
        "unavailable",
      );
    })();
  app.post(
    "/gateway/v1/life/read",
    {
      onRequest: async (request) => {
        await owners().authenticate(tokenFromRequest(request));
      },
      schema: {
        operationId: "readActivity",
        body: readActivitySchema,
        security: [{ gatewayService: [] }],
        response: {
          200: Type.Object(
            { activity: Type.Union([activitySchema, Type.Null()]) },
            { additionalProperties: false },
          ),
          400: managementProblemSchema,
          401: managementProblemSchema,
          403: managementProblemSchema,
          409: managementProblemSchema,
          503: managementProblemSchema,
          500: managementProblemSchema,
        },
      },
    },
    async (request) => {
      const input = request.body as { subjectId: string; activityId: string };
      if (input.subjectId !== (await owners().scope()).subjectId)
        throw managementProblem(
          "gateway.scope_denied",
          "Activity belongs to another Subject",
          "Use the current bound Subject",
          "authorization",
        );
      return {
        activity: (await owners().life.get(input.subjectId, input.activityId)) ?? null,
      };
    },
  );
}
