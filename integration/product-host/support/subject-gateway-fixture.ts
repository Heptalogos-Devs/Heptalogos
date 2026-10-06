// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type Server } from "node:http";

async function readJsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function messageTexts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((message) => {
    if (typeof message !== "object" || message === null) return "";
    const record = message as Record<string, unknown>;
    if (typeof record.content === "string") return record.content;
    if (typeof record.text === "string") return record.text;
    return JSON.stringify(message);
  });
}

/**
 * The one loopback provider used by Product Host integration qualification.
 * It implements the public OpenAI-compatible HTTP surface consumed by both
 * the Subject OpenClaw Gateway and the independent Expression AIRuntime path.
 */
export async function createSubjectGatewayFixture(): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
  readonly waitForSlowPrimary: () => Promise<void>;
  readonly releaseSlowPrimary: () => void;
  readonly waitForSlowExpression: () => Promise<void>;
  readonly releaseSlowExpression: () => void;
  readonly primaryInvocationCount: () => number;
  readonly expressionInvocationCount: () => number;
  readonly expressionBudgets: () => readonly number[];
  readonly primaryRequestMessages: () => readonly (readonly string[])[];
}> {
  const createGate = () => {
    let resolveStarted = () => {};
    let resolveReleased = () => {};
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      resolveReleased = resolve;
    });
    return {
      started,
      released,
      resolveStarted,
      resolveReleased,
    };
  };
  let slowPrimaryGate = createGate();
  let slowExpressionGate = createGate();
  let primaryInvocations = 0;
  let expressionInvocations = 0;
  const expressionBudgets: number[] = [];
  const primaryRequests: Array<readonly string[]> = [];
  const writeStreamingCompletion = (
    response: import("node:http").ServerResponse,
    payload: Record<string, unknown>,
    finishReason: string,
  ): void => {
    response.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    });
    const delta = (payload.choices as Array<Record<string, unknown>>)[0]!
      .message as Record<string, unknown>;
    const writeChunk = (
      chunkDelta: Record<string, unknown>,
      chunkFinishReason: string | null,
    ) =>
      response.write(
        `data: ${JSON.stringify({
          id: payload.id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: payload.model,
          choices: [{ index: 0, delta: chunkDelta, finish_reason: chunkFinishReason }],
        })}\n\n`,
      );
    writeChunk(delta, null);
    writeChunk({}, finishReason);
    response.end("data: [DONE]\n\n");
  };
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const body = await readJsonBody(request);
        const model = typeof body.model === "string" ? body.model : "";
        const isExpression = model.includes("expression");
        const isOpenClawPrimary =
          !isExpression &&
          Array.isArray(body.tools) &&
          body.tools.some((tool) => {
            if (typeof tool !== "object" || tool === null) return false;
            const value = tool as Record<string, unknown>;
            const functionValue =
              typeof value.function === "object" && value.function !== null
                ? (value.function as Record<string, unknown>)
                : undefined;
            return (
              functionValue?.name === "heptalogos_propose_communication" ||
              functionValue?.name === "heptalogos_complete_without_communication"
            );
          });
        if (isExpression) {
          expressionInvocations += 1;
          const budget = body.max_output_tokens ?? body.max_tokens;
          if (typeof budget === "number") expressionBudgets.push(budget);
        } else if (isOpenClawPrimary) {
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const hasToolResult = messages.some(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as Record<string, unknown>).role === "tool",
          );
          if (!hasToolResult) {
            primaryInvocations += 1;
            primaryRequests.push(messageTexts(messages));
          }
        } else {
          primaryInvocations += 1;
          primaryRequests.push(messageTexts(body.messages));
        }
        if (isOpenClawPrimary && model.includes("slow")) {
          const gate = slowPrimaryGate;
          gate.resolveStarted();
          await gate.released;
        }
        if (isExpression && model.includes("slow")) {
          const gate = slowExpressionGate;
          gate.resolveStarted();
          await gate.released;
        }
        const candidate = isExpression
          ? { schemaVersion: 1, text: "local expressed reply" }
          : model.includes("no-communication")
            ? { schemaVersion: 1, kind: "NO_COMMUNICATION" }
            : {
                schemaVersion: 1,
                kind: "COMMUNICATE",
                semanticContent: {
                  schemaVersion: 1,
                  content: "local semantic content",
                },
              };
        const path = request.url ?? "";
        const hasToolResult =
          Array.isArray(body.messages) &&
          body.messages.some(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              (message as Record<string, unknown>).role === "tool",
          );
        const openClawPayload = {
          id: "subject-openclaw-local",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: hasToolResult
                ? { role: "assistant", content: "Accepted the typed proposal." }
                : model.includes("no-communication") ||
                    JSON.stringify(body.messages ?? []).includes("quietly")
                  ? {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call-complete-without-communication",
                          type: "function",
                          function: {
                            name: "heptalogos_complete_without_communication",
                            arguments: "{}",
                          },
                        },
                      ],
                    }
                  : {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call-propose-communication",
                          type: "function",
                          function: {
                            name: "heptalogos_propose_communication",
                            arguments: JSON.stringify({
                              semanticContent: {
                                schemaVersion: 1,
                                content: "local semantic content",
                              },
                            }),
                          },
                        },
                      ],
                    },
              finish_reason: hasToolResult ? "stop" : "tool_calls",
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
        };
        const payload = isOpenClawPrimary
          ? openClawPayload
          : path.endsWith("/chat/completions")
            ? {
                id: "subject-chat-local",
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: JSON.stringify(candidate) },
                    finish_reason: "stop",
                  },
                ],
                usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
              }
            : path.endsWith("/responses")
              ? {
                  id: "subject-response-local",
                  object: "response",
                  created_at: Math.floor(Date.now() / 1000),
                  status: "completed",
                  model,
                  output: [
                    {
                      id: "subject-message-local",
                      type: "message",
                      status: "completed",
                      role: "assistant",
                      content: [
                        {
                          type: "output_text",
                          text: JSON.stringify(candidate),
                          annotations: [],
                          logprobs: [],
                        },
                      ],
                    },
                  ],
                  usage: {
                    input_tokens: 7,
                    output_tokens: 5,
                    total_tokens: 12,
                    input_tokens_details: { cached_tokens: 0 },
                    output_tokens_details: { reasoning_tokens: 0 },
                  },
                }
              : undefined;
        if (payload === undefined) {
          response.writeHead(404).end();
          return;
        }
        if (isOpenClawPrimary && body.stream === true) {
          const streamingPayload = payload as {
            readonly choices: readonly Record<string, any>[];
          };
          writeStreamingCompletion(
            response,
            streamingPayload as Record<string, unknown>,
            streamingPayload.choices[0]!.finish_reason as string,
          );
        } else {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(payload));
        }
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: String(error) }));
      }
    })();
  });
  // Intentional duplication: this server keeps its listening socket open to
  // publish the fixture endpoint; canonical-postgres only probes and closes a
  // port, so their cleanup/error ownership stays separate.
  /* jscpd:ignore-start */
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Subject Chat gateway fixture did not expose a port");
  }
  /* jscpd:ignore-end */
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    waitForSlowPrimary: () => slowPrimaryGate.started,
    releaseSlowPrimary: () => {
      const gate = slowPrimaryGate;
      slowPrimaryGate = createGate();
      gate.resolveReleased();
    },
    waitForSlowExpression: () => slowExpressionGate.started,
    // Intentional duplication: primary and expression gates are independent
    // scenario controls and must not share mutable release state.
    /* jscpd:ignore-start */
    releaseSlowExpression: () => {
      const gate = slowExpressionGate;
      slowExpressionGate = createGate();
      gate.resolveReleased();
    },
    /* jscpd:ignore-end */
    primaryInvocationCount: () => primaryInvocations,
    expressionInvocationCount: () => expressionInvocations,
    expressionBudgets: () => Object.freeze([...expressionBudgets]),
    primaryRequestMessages: () =>
      Object.freeze(primaryRequests.map((messages) => Object.freeze([...messages]))),
  };
}
