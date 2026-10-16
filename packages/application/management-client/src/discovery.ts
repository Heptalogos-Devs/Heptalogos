// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads the existing installation locator and verifies each live Host boot without credentials.
 * @module discovery
 */
import { objectValue, readJson } from "./json.js";
import { isAbsolute, join } from "node:path";
import {
  parseInstallationId,
  parseBootId,
  type InstallationId,
  type BootId,
} from "@heptalogos/foundation-contracts";
import { createManagementClient, type ManagementClientOptions } from "./client.js";
/** Public RUN metadata remains a snapshot of one verified Host boot. */
export interface ManagementEndpointDescriptor {
  readonly schemaVersion: 1;
  readonly installationId: InstallationId;
  readonly bootId: BootId;
  readonly origin: string;
}
/** Resolved roots and live identity for the installation originally bound by this reader. */
export interface LocalManagementEndpoint {
  readonly anchorRoot: string;
  readonly runRoot: string;
  readonly installationId: InstallationId;
  readonly endpoint: ManagementEndpointDescriptor;
}
/** Discovery sends no administrator or Gateway service credential. */
export interface LocalManagementEndpointOptions {
  readonly anchorRoot: string;
  readonly fetch?: ManagementClientOptions["fetch"];
  readonly signal?: AbortSignal;
}
/** Re-reads current boot metadata without silently changing installation identity. */
export interface LocalManagementEndpointReader {
  readonly anchorRoot: string;
  /** Verifies locator, RUN descriptor and public discovery before returning a destination. */
  read(): Promise<LocalManagementEndpoint>;
}

/** Shares the Node discovery owner with local administration and independently bundled Gateways. */
export function createLocalManagementEndpointReader(
  options: LocalManagementEndpointOptions,
): LocalManagementEndpointReader {
  if (!isAbsolute(options.anchorRoot))
    throw Error("The local Management locator is invalid");
  let boundInstallationId: InstallationId | undefined;
  return Object.freeze({
    anchorRoot: options.anchorRoot,
    async read() {
      const locator = objectValue(
        await readJson(join(options.anchorRoot, "heptalogos.bootstrap.json")),
      );
      const installationId = parseInstallationId(locator?.installationId);
      const roots = objectValue(locator?.roots);
      const runRoot = roots?.RUN;
      if (
        locator?.schemaVersion !== 1 ||
        !installationId ||
        typeof runRoot !== "string" ||
        !isAbsolute(runRoot)
      )
        throw Error("The local Management locator is invalid");
      boundInstallationId ??= installationId;
      if (installationId !== boundInstallationId)
        throw Error("The Management installation locator changed identity");
      const value = objectValue(
        await readJson(join(runRoot, "management-endpoint.json")),
      );
      const endpointId = parseInstallationId(value?.installationId);
      const bootId = parseBootId(value?.bootId);
      if (
        value?.schemaVersion !== 1 ||
        !endpointId ||
        !bootId ||
        typeof value.origin !== "string"
      )
        throw Error("The local Management endpoint descriptor is unavailable");
      if (endpointId !== installationId)
        throw Error("The Management endpoint does not match the installation locator");
      let origin: URL;
      try {
        origin = new URL(value.origin);
      } catch {
        throw Error("The local Management endpoint descriptor is invalid");
      }
      if (
        origin.protocol !== "http:" ||
        origin.hostname !== "127.0.0.1" ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      )
        throw Error("The local Management endpoint is not a loopback origin");
      const endpoint: ManagementEndpointDescriptor = Object.freeze({
        schemaVersion: 1,
        installationId,
        bootId,
        origin: origin.origin,
      });
      const discovery = await createManagementClient({
        origin: endpoint.origin,
        signal: options.signal,
        fetch: (input, init) =>
          (options.fetch ?? fetch)(input, { ...init, redirect: "error" }),
      }).getDiscovery();
      if (
        discovery.installationId !== installationId ||
        discovery.bootId !== bootId ||
        discovery.apiBasePath !== "/v1" ||
        discovery.contractVersion !== "management.v1"
      )
        throw Error(
          "The live Management contract does not match the endpoint descriptor",
        );
      return Object.freeze({
        anchorRoot: options.anchorRoot,
        runRoot,
        installationId,
        endpoint,
      });
    },
  });
}
