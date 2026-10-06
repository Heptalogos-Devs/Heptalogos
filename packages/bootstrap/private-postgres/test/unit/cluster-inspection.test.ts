// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  parsePgControldata,
  readPrivatePostgresMajor,
} from "../../src/cluster-inspection.js";

const CONTROL_DATA = `Database system identifier:           7423910482159265041
Database cluster state:               in production
pg_control last modified:             Fri 21 Aug 2026 09:00:00 JST
Catalog version number:               202507171
Database system identifier checksum:  not-used
Data page checksum version:           1
`;

describe("private PostgreSQL cluster inspection", () => {
  it("parses deterministic C-locale pg_controldata fields", () => {
    expect(parsePgControldata(CONTROL_DATA)).toEqual({
      clusterSystemIdentifier: "7423910482159265041",
      databaseClusterState: "in production",
      catalogVersionNumber: "202507171",
      dataPageChecksumVersion: 1,
    });
  });

  it("preserves the cluster system identifier as a decimal string", () => {
    const parsed = parsePgControldata(CONTROL_DATA);
    expect(typeof parsed.clusterSystemIdentifier).toBe("string");
    expect(parsed.clusterSystemIdentifier).toBe("7423910482159265041");
  });

  it("rejects missing or malformed control-data fields", () => {
    expect(() =>
      parsePgControldata("Database cluster state: in production\n"),
    ).toThrowError();
    expect(() =>
      parsePgControldata(
        CONTROL_DATA.replace(
          "Database system identifier:           7423910482159265041",
          "Database system identifier:           74x",
        ),
      ),
    ).toThrowError();
  });

  it("accepts only exact PostgreSQL major text 18", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "heptalogos-pg-cluster-"));
    await writeFile(join(dataDirectory, "PG_VERSION"), "18\n");

    await expect(readPrivatePostgresMajor(dataDirectory)).resolves.toBe(18);
  });

  it("rejects a malformed or different PG_VERSION major", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "heptalogos-pg-cluster-"));
    await writeFile(join(dataDirectory, "PG_VERSION"), "19\n");

    await expect(readPrivatePostgresMajor(dataDirectory)).rejects.toMatchObject({
      problem: { problemCode: "private-postgres.cluster.pg_version_mismatch" },
    });
  });
});
