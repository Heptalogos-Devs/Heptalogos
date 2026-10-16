// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProtocolMedia } from "../../src/media.js";
import type { OneBotTransport } from "../../src/transport.js";

const network = vi.hoisted(() => ({ fetch: vi.fn() }));
// Only the HTTP boundary is isolated; MIME sniffing and protected file/byte accounting stay real.
vi.mock("openclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: network.fetch,
}));

it("refreshes a group file directly with exact IDs and consumes the returned QQ URL under existing limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-group-file-"));
  const bytes = Buffer.from("actual isolated group-file fixture bytes");
  const url = "https://njc-download.ftn.qq.com/fixture";
  const release = vi.fn(async () => {});
  network.fetch.mockResolvedValue({ response: new Response(bytes), release });
  const read = vi.fn(async () => ({ url }));
  const transport = { read } as unknown as OneBotTransport;
  const reserveBytes = vi.fn(async (_bytes: number) => {});
  const options = {
    groupId: "900719925474099312345",
    tempRoot: root,
    exportRoots: [],
    maxBytes: 1024,
    timeoutMs: 1000,
    reserveBytes,
    signal: new AbortController().signal,
  };
  try {
    const result = await acquireProtocolMedia(
      transport,
      {
        type: "file",
        data: { file_id: "900719925474099399999", file: "untrusted filename" },
      },
      options,
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(
      "get_group_file_url",
      {
        file_id: "900719925474099399999",
        group_id: options.groupId,
      },
      options.signal,
    );
    expect(network.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url,
        requireHttps: true,
        maxRedirects: 0,
        mode: "strict",
        pinDns: true,
      }),
    );
    expect(await readFile(result.path)).toEqual(bytes);
    expect(result.bytes).toBe(bytes.length);
    expect(reserveBytes).toHaveBeenCalledWith(bytes.length);
    expect(release).toHaveBeenCalledOnce();
    await result.dispose();
    read.mockResolvedValue({ url: "https://127.0.0.1/private" });
    await expect(
      acquireProtocolMedia(
        transport,
        { type: "file", data: { file_id: "file-id" } },
        options,
      ),
    ).rejects.toMatchObject({ code: "source_unavailable" });
    expect(network.fetch).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
