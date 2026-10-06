// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

export function parseRecoveryMaintenanceProcessArgs(argv) {
  const [anchorRoot, role, ...args] = argv;
  if (!anchorRoot || !role) {
    throw new Error(
      "usage: recovery-maintenance-process.mjs <anchor> <role> [pg-bin] [port] [operation-id] [target-phase]",
    );
  }

  if (role === "maintenance") {
    const [pgBin, portText, targetPhase, ...extra] = args;
    if (!pgBin || !portText || !targetPhase || extra.length > 0) {
      throw new Error(
        "maintenance usage: <anchor> maintenance <pg-bin> <port> <target-phase>",
      );
    }
    return { anchorRoot, role, pgBin, portText, targetPhase };
  }

  if (role === "maintenance-prepared") {
    const [pgBin, portText, ...extra] = args;
    if (!pgBin || !portText || extra.length > 0) {
      throw new Error(
        "maintenance-prepared usage: <anchor> maintenance-prepared <pg-bin> <port>",
      );
    }
    return { anchorRoot, role, pgBin, portText };
  }

  if (role === "recovery") {
    const [pgBin, portText, operationIdText, targetPhase, ...extra] = args;
    if (!pgBin || !portText || !operationIdText || !targetPhase || extra.length > 0) {
      throw new Error(
        "recovery usage: <anchor> recovery <pg-bin> <port> <operation-id> <target-phase>",
      );
    }
    return { anchorRoot, role, pgBin, portText, operationIdText, targetPhase };
  }

  if (role === "recovery-complete") {
    const [pgBin, portText, operationIdText, ...extra] = args;
    if (!pgBin || !portText || !operationIdText || extra.length > 0) {
      throw new Error(
        "recovery-complete usage: <anchor> recovery-complete <pg-bin> <port> <operation-id>",
      );
    }
    return { anchorRoot, role, pgBin, portText, operationIdText };
  }

  throw new Error(`unsupported role ${role}`);
}
