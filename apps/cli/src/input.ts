// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Protected password input for interactive and deterministic CLI modes.
 * @module password
 */

import {password,isCancel} from "@clack/prompts";
import {problem} from "@nous-wave/platform/errors";

/** Reads one password from stdin while preserving all non-line-ending bytes. */
async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const value = Buffer.concat(chunks).toString("utf8");
  return value.replace(/(?:\r\n|\n|\r)$/u, "");
}

/** Uses the adopted Inquirer password prompt for protected TTY input. */
export async function readProtectedPassword(
  useStdin: boolean,
  message: string,
): Promise<string> {
  if (useStdin) return readPasswordFromStdin();
  if(!process.stdin.isTTY)throw problem("cli.password_input_required","validation","请使用密码环境引用或 --password-stdin");
  const value=await password({message});
  if(isCancel(value))throw problem("cli.cancelled","validation","操作已取消");
  return value;
}

/** Reads one protected JSON action body from stdin without exposing argv input. */
export async function readProtectedJsonFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    bytes += buffer.length;
    if (bytes > 65_536) {
      chunks.forEach((item) => item.fill(0));
      throw problem("cli.input_too_large","validation","JSON输入超过65536字节");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) throw problem("cli.empty_input","validation","JSON输入为空");
  try {
    try{return JSON.parse(text) as unknown;}catch{throw problem("cli.invalid_json","validation","JSON输入格式无效");}
  } finally {
    chunks.forEach((chunk) => chunk.fill(0));
  }
}
