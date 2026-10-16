// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Acquires only protocol-confirmed QQ media into protected bounded temporary files.
 * @module media
 */
import { open, realpath, mkdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join, resolve, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import { detectMime } from "openclaw/plugin-sdk/media-mime";
import { OneBotTransport } from "./transport.js";
import { nativeId, record } from "./lossless.js";

/** Downloader limits are real byte/time/concurrency inputs, not advisory metadata. */
export interface MediaAcquisitionOptions {
  readonly tempRoot: string;
  /** Actual source envelope group, never inferred from a filename or model argument. */
  readonly groupId?: string;
  readonly exportRoots: readonly string[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly allowFakeIpDns?: boolean;
  readonly reserveBytes: (bytes: number) => Promise<void>;
  readonly signal: AbortSignal;
}
/** A protected temporary artifact is handed directly to Host CAS upload, then disposed. */
export interface AcquiredMedia {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mediaType: string;
  readonly dispose: () => Promise<void>;
}
const qqMediaHosts = [
  "qq.com",
  "qq.com.cn",
  "qpic.cn",
  "gtimg.cn",
  "qqusercontent.com",
];
function allowedUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return undefined;
    return qqMediaHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith("." + host),
    )
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
/** A typed acquisition failure never includes signed URLs, local raw paths or bodies. */
export class QqMediaError extends Error {
  /** Creates this adapter boundary with explicitly supplied validated operational state. */
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`QQ media ${code}`);
    this.name = "QqMediaError";
  }
}
async function permittedExport(
  path: string,
  roots: readonly string[],
): Promise<string | undefined> {
  const file = await realpath(path).catch(() => undefined);
  if (!file) return undefined;
  for (const root of roots) {
    const canonical = await realpath(root).catch(() => undefined);
    if (canonical && file.startsWith(resolve(canonical) + sep)) return file;
  }
  return undefined;
}
/** Refreshes expired URLs through the protocol identity; model-supplied paths never enter this API. */
export async function acquireProtocolMedia(
  transport: OneBotTransport,
  segment: Record<string, unknown>,
  options: MediaAcquisitionOptions,
): Promise<AcquiredMedia> {
  const type = typeof segment.type === "string" ? segment.type : "unknown";
  const data = record(segment.data);
  const identity = nativeId(data.file_id) ?? nativeId(data.file) ?? nativeId(data.id);
  let source = record(data);
  let url = allowedUrl(source.url);
  let file: string | undefined;
  let protocolConfirmed = false;
  if (identity) {
    const refreshed = await transport
      .read(
        type === "file" && options.groupId
          ? "get_group_file_url"
          : type === "image" || type === "mface"
            ? "get_image"
            : type === "record" || type === "audio"
              ? "get_record"
              : "get_file",
        {
          [type === "image" || type === "mface" || type === "record" || type === "audio"
            ? "file"
            : "file_id"]: identity,
          ...(type === "record" || type === "audio" ? { out_format: "mp3" } : {}),
          ...(type === "file" && options.groupId ? { group_id: options.groupId } : {}),
        },
        options.signal,
      )
      .catch(() => undefined);
    if (refreshed) {
      protocolConfirmed = true;
      source = refreshed;
      url = allowedUrl(refreshed.url) ?? url;
      const path =
        typeof refreshed.file === "string"
          ? refreshed.file
          : typeof refreshed.file_path === "string"
            ? refreshed.file_path
            : undefined;
      if (path && !path.includes("://"))
        file = await permittedExport(path, options.exportRoots);
    }
  }
  let inline: Buffer | undefined;
  // Only the authenticated protocol read response can supply bytes; never a model-supplied segment.
  if (
    !file &&
    protocolConfirmed &&
    typeof source.base64 === "string" &&
    (!url || type === "record" || type === "audio")
  ) {
    const value = source.base64;
    if (value.length > Math.ceil(options.maxBytes / 3) * 4)
      throw new QqMediaError("size_limit", false);
    inline = Buffer.from(value, "base64");
    if (!inline.length || inline.toString("base64") !== value)
      throw new QqMediaError("invalid_protocol_base64", false);
    if (inline.length > options.maxBytes) throw new QqMediaError("size_limit", false);
  }
  if (!url && !file && !inline) throw new QqMediaError("source_unavailable", true);
  await mkdir(options.tempRoot, { recursive: true, mode: 0o700 });
  const destination = join(options.tempRoot, `${randomUUID()}.part`);
  const handle = await open(destination, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  let sniff = Buffer.alloc(0);
  let release: (() => Promise<void>) | undefined;
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(options.timeoutMs),
  ]);
  try {
    let chunks: AsyncIterable<Uint8Array>;
    if (inline) {
      chunks = Readable.from([inline], { signal });
    } else if (file) {
      chunks = createReadStream(file, { signal });
    } else {
      const fetched = await fetchWithSsrFGuard({
        url: url!.href,
        signal,
        timeoutMs: options.timeoutMs,
        requireHttps: true,
        maxRedirects: 0,
        capture: false,
        mode: "strict",
        pinDns: true,
        policy: {
          allowRfc2544BenchmarkRange: options.allowFakeIpDns === true,
          hostnameAllowlist: qqMediaHosts.flatMap((host) => [host, "*." + host]),
        },
      });
      release = fetched.release;
      if ([404, 410].includes(fetched.response.status))
        throw new QqMediaError("expired", false);
      if (!fetched.response.ok || !fetched.response.body)
        throw new QqMediaError("fetch_unavailable", true);
      const declared = fetched.response.headers.get("content-length");
      if (declared && Number(declared) > options.maxBytes)
        throw new QqMediaError("size_limit", false);
      chunks = fetched.response.body as unknown as AsyncIterable<Uint8Array>;
    }
    for await (const chunk of chunks) {
      signal.throwIfAborted();
      bytes += chunk.byteLength;
      if (bytes > options.maxBytes) throw new QqMediaError("size_limit", false);
      await options.reserveBytes(chunk.byteLength);
      hash.update(chunk);
      if (sniff.byteLength < 16384)
        sniff = Buffer.concat([
          sniff,
          Buffer.from(chunk.subarray(0, 16384 - sniff.byteLength)),
        ]);
      await handle.writeFile(chunk);
    }
    await handle.sync();
    await handle.close();
    const mediaType =
      (await detectMime({ buffer: sniff })) ?? "application/octet-stream";
    return {
      path: destination,
      bytes,
      sha256: hash.digest("hex"),
      mediaType,
      dispose: () => rm(destination, { force: true }),
    };
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(destination, { force: true });
    if (error instanceof QqMediaError) throw error;
    throw new QqMediaError(
      signal.aborted ? "cancelled_or_timeout" : "acquisition_failed",
      true,
    );
  } finally {
    await release?.().catch(() => {});
  }
}
