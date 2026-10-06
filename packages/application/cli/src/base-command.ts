// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared command boundary for the reference CLI.
 * @module base-command
 */

import { Command, Flags } from "@oclif/core";
import { ManagementClientError } from "@heptalogos/management-client";
import {
  openLocalManagementClient,
  type LocalManagementClient,
} from "@heptalogos/management-client/node";

/** Common flags accepted by every current CLI command. */
const commonFlags = {
  "anchor-root": Flags.string({
    description: "Installation anchor containing the Bootstrap locator",
    required: true,
  }),
};

/** A safe, stable CLI failure with the plan's coarse exit classification. */
export class CliFailure extends Error {
  readonly problemCode: string;
  readonly status?: number;
  readonly category?: string;
  readonly retryClass?: string;
  readonly exitCode: number;

  /** Creates a classified CLI failure. */
  constructor(
    problemCode: string,
    message: string,
    exitCode: number,
    status?: number,
    category?: string,
    retryClass?: string,
  ) {
    super(message);
    this.name = "CliFailure";
    this.problemCode = problemCode;
    this.status = status;
    this.category = category;
    this.retryClass = retryClass;
    this.exitCode = exitCode;
  }
}

function exitCodeFor(status: number | undefined): number {
  if (status === 400) return 2;
  if (status === 401 || status === 403) return 3;
  if (status === 426) return 5;
  if (status === 409 || status === 412) return 6;
  if (status !== undefined && status >= 500) return 7;
  return 4;
}

function toCliFailure(error: unknown): CliFailure {
  if (error instanceof CliFailure) return error;
  if (error instanceof ManagementClientError) {
    const code = error.problem?.problemCode ?? "management.host_unavailable";
    return new CliFailure(
      code,
      error.problem?.detail ?? "The Management Host is unavailable",
      exitCodeFor(error.status),
      error.status,
      error.problem?.category,
      error.problem?.retryClass,
    );
  }
  return new CliFailure(
    "management.host_unavailable",
    "The Management Host is unavailable",
    4,
  );
}

/** Base command that enforces local discovery, machine output, and exit classes. */
export abstract class BaseCommand extends Command {
  static baseFlags = commonFlags;
  static enableJsonFlag = true;

  protected async execute<T>(
    anchorRoot: string,
    operation: (local: LocalManagementClient) => Promise<T>,
    authenticated = false,
  ): Promise<T | undefined> {
    let local: LocalManagementClient | undefined;
    try {
      local = await openLocalManagementClient({ anchorRoot });
      if (authenticated) {
        const sessionToken = await local.readSessionToken();
        if (sessionToken === undefined) {
          throw new CliFailure(
            "management.session_invalid",
            "No local Management session is available",
            3,
            401,
          );
        }
        local = await openLocalManagementClient({
          anchorRoot,
          sessionToken,
        });
      }
      const value = await operation(local);
      return this.present(value);
    } catch (error) {
      if (
        authenticated &&
        local !== undefined &&
        error instanceof ManagementClientError &&
        error.status === 401
      ) {
        await local.deleteSessionToken().catch(() => undefined);
      }
      throw toCliFailure(error);
    }
  }

  protected present<T>(value: T): T | undefined {
    if (this.jsonEnabled()) return value;
    this.log(JSON.stringify(value, null, 2));
    return undefined;
  }

  protected parsedFlags<T extends Record<string, unknown>>(
    command: typeof Command,
  ): Promise<T> {
    return this.parse(command).then((result) => result.flags as unknown as T);
  }
}

/** The flag shape shared by all command implementations. */
export type CommonFlags = {
  readonly "anchor-root": string;
};

/** Gets an authenticated Management client after local token discovery. */
