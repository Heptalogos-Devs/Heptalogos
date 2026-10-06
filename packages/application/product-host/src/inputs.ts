// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Parses the deliberately small Product Host bootstrap argument surface.
 * @module inputs
 */

import { isAbsolute } from "node:path";
import {
  createProblemError,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

/** Validated command-line inputs accepted by the headless Product Host. */
export interface ProductHostInputs {
  readonly anchorRoot: string;
  readonly postgresBinDirectory: string;
  readonly initialPostgresPort?: number;
}

function inputProblem(detail: string): ProblemError {
  return createProblemError({
    problemCode: "product-host.invalid_input",
    category: "validation",
    retryClass: "manual",
    title: "Product Host input is invalid",
    detail,
  });
}

/** Parses bootstrap/process arguments and rejects every unknown argument. */
export function parseProductHostInputs(argv: readonly string[]): ProductHostInputs {
  let anchorRoot: string | undefined;
  let postgresBinDirectory: string | undefined;
  let initialPostgresPort: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (
      (option === "--anchor-root" || option === "--postgres-bin") &&
      (value === undefined || value.startsWith("--"))
    ) {
      throw inputProblem("Each Product Host path option requires one value");
    }
    switch (option) {
      case "--anchor-root":
        anchorRoot = value;
        index += 1;
        break;
      case "--postgres-bin":
        postgresBinDirectory = value;
        index += 1;
        break;
      case "--initial-postgres-port": {
        if (value === undefined || value.startsWith("--")) {
          throw inputProblem("The initial PostgreSQL port requires one value");
        }
        const port = Number(value);
        if (
          !/^[0-9]+$/u.test(value) ||
          !Number.isInteger(port) ||
          port < 1 ||
          port > 65_535
        ) {
          throw inputProblem(
            "The initial PostgreSQL port must be an integer from 1 to 65535",
          );
        }
        initialPostgresPort = port;
        index += 1;
        break;
      }
      default:
        throw inputProblem(
          "Only --anchor-root, --postgres-bin, and --initial-postgres-port are accepted",
        );
    }
  }
  if (anchorRoot === undefined || postgresBinDirectory === undefined) {
    throw inputProblem("Product Host requires --anchor-root and --postgres-bin");
  }
  if (!isAbsolute(anchorRoot) || !isAbsolute(postgresBinDirectory)) {
    throw inputProblem("Product Host bootstrap paths must be absolute");
  }
  return Object.freeze({
    anchorRoot,
    postgresBinDirectory,
    ...(initialPostgresPort === undefined ? {} : { initialPostgresPort }),
  });
}
