// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parsePostgresVersion,
  privatePostgresExecutableNames,
  resolvePrivatePostgresExecutablePaths,
  resolvePrivatePostgresToolchain,
} from "../../src/toolchain.js";

describe("parsePostgresVersion", () => {
  it("parses the exact qualified postgres version", () => {
    expect(parsePostgresVersion("postgres (PostgreSQL) 18.6\n")).toEqual({
      major: 18,
      version: "18.6",
    });
  });

  it("parses the exact qualified pg_ctl version", () => {
    expect(parsePostgresVersion("pg_ctl (PostgreSQL) 18.6\n")).toEqual({
      major: 18,
      version: "18.6",
    });
  });

  it("accepts an exact qualified version with a distribution build suffix", () => {
    expect(
      parsePostgresVersion(
        "postgres (PostgreSQL) 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)\n",
      ),
    ).toEqual({ major: 18, version: "18.6" });
  });

  it("rejects a non-qualified PostgreSQL patch version", () => {
    expect(() => parsePostgresVersion("postgres (PostgreSQL) 18.4\n")).toThrowError();
  });

  it("rejects a beta version", () => {
    expect(() =>
      parsePostgresVersion("postgres (PostgreSQL) 19beta3\n"),
    ).toThrowError();
  });

  it("rejects arbitrary output", () => {
    expect(() => parsePostgresVersion("garbage")).toThrowError();
  });
});

describe("private PostgreSQL version Authority", () => {
  it("derives public type and diagnostic versions from package constants", () => {
    const contracts = readFileSync(
      fileURLToPath(new URL("../../src/contracts.ts", import.meta.url)),
      "utf8",
    );
    const toolchain = readFileSync(
      fileURLToPath(new URL("../../src/toolchain.ts", import.meta.url)),
      "utf8",
    );

    expect(contracts).toContain(
      "readonly version: typeof PRIVATE_POSTGRES_QUALIFIED_VERSION;",
    );
    expect(contracts).toContain(
      "readonly major: typeof PRIVATE_POSTGRES_ARCHITECTURE_MAJOR;",
    );
    expect(contracts).toContain(
      "readonly dataLayoutVersion: typeof PRIVATE_POSTGRES_DATA_LAYOUT_VERSION;",
    );
    expect(contracts).not.toContain('readonly version: "18.6";');
    expect(contracts).not.toContain("readonly major: 18;");
    expect(contracts).not.toContain("readonly dataLayoutVersion: 1;");
    expect(toolchain).toContain("PRIVATE_POSTGRES_QUALIFIED_VERSION");
    expect(toolchain).toContain("PRIVATE_POSTGRES_ARCHITECTURE_MAJOR");
    expect(toolchain).not.toContain("exact qualified version 18.6");
  });
});

describe("private PostgreSQL executable paths", () => {
  it("uses deterministic POSIX executable names", () => {
    expect(privatePostgresExecutableNames("linux")).toEqual([
      "postgres",
      "initdb",
      "pg_ctl",
      "pg_controldata",
      "pg_isready",
    ]);
  });

  it("uses deterministic Windows executable names", () => {
    expect(privatePostgresExecutableNames("win32")).toEqual([
      "postgres.exe",
      "initdb.exe",
      "pg_ctl.exe",
      "pg_controldata.exe",
      "pg_isready.exe",
    ]);
  });

  it("derives only absolute paths from an absolute bin directory", () => {
    expect(resolvePrivatePostgresExecutablePaths("/opt/postgres/bin", "linux")).toEqual(
      {
        postgres: "/opt/postgres/bin/postgres",
        initdb: "/opt/postgres/bin/initdb",
        pgCtl: "/opt/postgres/bin/pg_ctl",
        pgControldata: "/opt/postgres/bin/pg_controldata",
        pgIsReady: "/opt/postgres/bin/pg_isready",
      },
    );
  });

  it("rejects a relative bin directory before filesystem inspection", async () => {
    await expect(resolvePrivatePostgresToolchain("postgres/bin")).rejects.toMatchObject(
      {
        problem: { problemCode: "private-postgres.toolchain.invalid_bin_directory" },
      },
    );
  });

  it("rejects a missing required tool without searching PATH", async () => {
    const binDirectory = await mkdtemp(join(tmpdir(), "heptalogos-pg-bin-"));

    await expect(resolvePrivatePostgresToolchain(binDirectory)).rejects.toMatchObject({
      problem: { problemCode: "private-postgres.toolchain.tool_missing" },
    });
  });

  it("rejects a required tool that is not a regular file", async () => {
    const binDirectory = await mkdtemp(join(tmpdir(), "heptalogos-pg-bin-"));
    await mkdir(
      join(binDirectory, privatePostgresExecutableNames(process.platform)[0]),
    );

    await expect(resolvePrivatePostgresToolchain(binDirectory)).rejects.toMatchObject({
      problem: { problemCode: "private-postgres.toolchain.tool_not_file" },
    });
  });

  it("does not accept a regular file fixture as a tool before validation", async () => {
    const binDirectory = await mkdtemp(join(tmpdir(), "heptalogos-pg-bin-"));
    await writeFile(
      join(binDirectory, privatePostgresExecutableNames(process.platform)[0]),
      "not an executable",
    );

    await expect(resolvePrivatePostgresToolchain(binDirectory)).rejects.toMatchObject({
      problem: { problemCode: "private-postgres.toolchain.tool_missing" },
    });
  });
});
