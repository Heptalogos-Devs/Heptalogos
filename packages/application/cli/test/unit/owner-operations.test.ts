// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  createManagementClient,
  ManagementClientError,
} from "@heptalogos/management-client";
import type { LocalManagementClient } from "@heptalogos/management-client/node";
import { openOperatorGateway } from "../../src/gateway-access.js";
import { invokeOwnerOperation } from "../../src/owner-operations.js";
import { toCliFailure } from "../../src/base-command.js";
const directories: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const installationId = "0199e800-0000-7000-8000-000000000001",
  bootId = "0199e800-0000-7000-8000-000000000002";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-owner-cli-"));
  directories.push(root);
  const run = join(root, "run"),
    secret = join(root, "secret");
  await mkdir(run);
  await mkdir(secret, { mode: 0o700 });
  const admin = "fixture-administrator-session",
    service = "fixture-private-service-credential";
  let authenticated = true,
    serviceAccepted = true;
  const received: { path: string; body: unknown; authorization: string | undefined }[] =
    [];
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("content-type", "application/json");
      const path = request.url!;
      if (path === "/.well-known/heptalogos-management") {
        response.end(
          JSON.stringify({
            installationId,
            bootId,
            apiBasePath: "/v1",
            contractVersion: "management.v1",
          }),
        );
        return;
      }
      if (path === "/v1/config") {
        if (authenticated && request.headers.authorization === "Bearer " + admin) {
          response.end(JSON.stringify({ revision: "fixture", settings: null }));
          return;
        }
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            type: "about:blank",
            title: "Fixture authorization",
            category: "authorization",
            retryClass: "manual",
            problemCode: "management.session_invalid",
            detail: "fixture denied",
            status: 401,
          }),
        );
        return;
      }
      if (request.method !== "POST") {
        response.statusCode = 404;
        response.end(JSON.stringify({ detail: "unknown fixture route" }));
        return;
      }
      let raw = "";
      for await (const part of request) raw += String(part);
      received.push({
        path,
        body: JSON.parse(raw),
        authorization: request.headers.authorization,
      });
      if (!serviceAccepted || request.headers.authorization !== "Bearer " + service) {
        response.statusCode = 401;
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            type: "about:blank",
            title: "Fixture service authorization",
            category: "authorization",
            retryClass: "manual",
            problemCode: "gateway.service_invalid",
            detail: "fixture service denied",
            status: 401,
          }),
        );
        return;
      }
      if (path.endsWith("/transition")) {
        response.statusCode = 409;
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            type: "about:blank",
            title: "Fixture CAS conflict",
            problemCode: "life.conflict",
            detail: "Read current revision",
            status: 409,
            category: "conflict",
            retryClass: "manual",
          }),
        );
        return;
      }
      response.end(
        JSON.stringify(
          path.endsWith("/history")
            ? { history: [], nextRevision: null }
            : path.endsWith("/pursuit/list")
              ? { pursuits: [], nextId: null }
              : path.endsWith("/life/read")
                ? { activity: null }
                : { activities: [], nextId: null },
        ),
      );
    })().catch(() => {
      response.statusCode = 500;
      response.end(JSON.stringify({ detail: "fixture failure" }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("fixture listener unavailable");
  const origin = "http://127.0.0.1:" + address.port;
  await writeFile(
    join(root, "heptalogos.bootstrap.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId,
      roots: { RUN: run, SECRET: secret },
    }),
  );
  await writeFile(
    join(run, "management-endpoint.json"),
    JSON.stringify({ schemaVersion: 1, installationId, bootId, origin }),
  );
  await writeFile(join(secret, "channel-service-token"), service, { mode: 0o600 });
  const local = {
    anchorRoot: root,
    installationId,
    client: createManagementClient({ origin, sessionToken: admin }),
  } as LocalManagementClient;
  return {
    root,
    secret,
    local,
    received,
    disableAdministrator: () => {
      authenticated = false;
    },
    disableService: () => {
      serviceAccepted = false;
    },
  };
}
describe("deterministic administrator owner command boundary", () => {
  it("authenticates the administrator before opening same-installation service access and forwards exact owner JSON", async () => {
    const f = await fixture();
    const client = await openOperatorGateway(f.local);
    const list = {
      subjectId: "0199e800-0000-7000-8000-000000000003",
      states: ["active"],
      limit: 12,
    };
    expect(await invokeOwnerOperation(client, "life", "list", list)).toEqual({
      activities: [],
      nextId: null,
    });
    expect(f.received[0]!.body).toEqual(list);
    expect(f.received[0]!.path).toBe("/gateway/v1/life/schedule");
    expect(f.received[0]!.authorization).toBe(
      "Bearer fixture-private-service-credential",
    );
    const history = {
      subjectId: list.subjectId,
      pursuitId: "0199e800-0000-7000-8000-000000000004",
      afterRevision: 3,
      limit: 8,
    };
    expect(await invokeOwnerOperation(client, "pursuit", "history", history)).toEqual({
      history: [],
      nextRevision: null,
    });
    expect(f.received[1]!.body).toEqual(history);
    const cas = {
      subjectId: list.subjectId,
      activityId: history.pursuitId,
      expectedRevision: 7,
      action: "pause",
      reason: "Explicit actual operator decision",
    };
    try {
      await invokeOwnerOperation(client, "life", "transition", cas);
      throw Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ManagementClientError);
      expect(toCliFailure(error)).toMatchObject({
        exitCode: 6,
        status: 409,
        problemCode: "life.conflict",
      });
    }
    expect(f.received.filter((item) => item.path.endsWith("transition"))).toHaveLength(
      1,
    );
    expect(f.received.at(-1)!.body).toEqual(cas);
  });
  it("never reads a missing service credential when the administrator is denied, and rejects changed installation/private-file access", async () => {
    const f = await fixture();
    await rm(join(f.secret, "channel-service-token"));
    f.disableAdministrator();
    await expect(openOperatorGateway(f.local)).rejects.toMatchObject({ status: 401 });
    expect(f.received).toHaveLength(0);
    const second = await fixture();
    await writeFile(
      join(second.root, "heptalogos.bootstrap.json"),
      JSON.stringify({
        schemaVersion: 1,
        installationId: "0199e800-0000-7000-8000-000000000099",
        roots: { SECRET: second.secret },
      }),
    );
    await expect(openOperatorGateway(second.local)).rejects.toMatchObject({
      exitCode: 4,
      problemCode: "installation.gateway_credential_unavailable",
    });
    expect(second.received).toHaveLength(0);
    if (process.platform !== "win32") {
      const third = await fixture();
      await chmod(join(third.secret, "channel-service-token"), 0o644);
      await expect(openOperatorGateway(third.local)).rejects.toMatchObject({
        exitCode: 4,
      });
      expect(third.received).toHaveLength(0);
    }
  });
  it("classifies Gateway credential errors without automatic retries or exposing the private token", async () => {
    const f = await fixture();
    const client = await openOperatorGateway(f.local);
    f.disableService();
    try {
      await invokeOwnerOperation(client, "pursuit", "list", {
        subjectId: installationId,
        states: [],
        limit: 10,
      });
      throw Error("expected denial");
    } catch (error) {
      const failure = toCliFailure(error);
      expect(failure.exitCode).toBe(3);
      expect(failure.message).not.toContain("fixture-private-service-credential");
    }
    expect(f.received).toHaveLength(1);
  });
});
