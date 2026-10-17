// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Registers the existing authenticated JSON transport without moving owner authorization.
 * @module gateway-route
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Static, TSchema } from "@heptalogos/schema-runtime/typebox";
import { managementProblemSchema } from "@heptalogos/management";
/** All Gateway operations use the same Problem response envelope. */
const gatewayProblemResponses = {
  400: managementProblemSchema,
  401: managementProblemSchema,
  403: managementProblemSchema,
  409: managementProblemSchema,
  503: managementProblemSchema,
  500: managementProblemSchema,
};
/** Named owner operation groups share this schema-preserving registration signature. */
export type NamedGatewayRoute = <T extends TSchema>(
  name: string,
  path: string,
  input: T,
  output: TSchema,
  operation: (value: Static<T>) => Promise<unknown>,
) => void;
/** Optional service credentials retain their owner's authentication classification. */
export function gatewayBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}
/** Owners keep their Subject checks, execution identity and mutations in the supplied operation. */
export function registerGatewayPost<T extends TSchema>(
  app: FastifyInstance,
  options: {
    readonly path: string;
    readonly operationId: string;
    readonly input: T;
    readonly output: TSchema;
    readonly bodyLimit?: number;
    readonly authenticate: (request: FastifyRequest) => Promise<void>;
    readonly operation: (
      input: Static<T>,
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<unknown>;
  },
) {
  app.post(
    options.path,
    {
      ...(options.bodyLimit === undefined ? {} : { bodyLimit: options.bodyLimit }),
      onRequest: options.authenticate,
      schema: {
        operationId: options.operationId,
        body: options.input,
        security: [{ gatewayService: [] }],
        response: { 200: options.output, ...gatewayProblemResponses },
      },
    },
    (request, reply) => options.operation(request.body as Static<T>, request, reply),
  );
}
