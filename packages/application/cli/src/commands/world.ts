// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicit world operations through the same local administrator and generated Gateway client.
 * @module commands/world
 */
import { Args, Flags } from "@oclif/core";
import { readFile, stat } from "node:fs/promises";
import { BaseCommand, CliFailure, toCliFailure } from "../base-command.js";
import { openOperatorGateway } from "../gateway-access.js";
import { readProtectedJsonFromStdin } from "../password.js";
import {
  worldOperations,
  worldRequest,
  worldDocumentOperations,
} from "../world-request.js";
/** Read commands use ordinary parameters; import/realize require an exact bounded JSON request. */
export default class World extends BaseCommand {
  static summary = "配置世界、课表与入场，查询日历和实际生活状态";
  static description =
    "read/calendar/profile-read/living/clock/query/history/coverage 不调用模型。clock-configure 是明确的官方 Clock 管理操作，不会随 profile-adopt 自动迁移旧主体。profile-adopt 独立于可选 Seed；首次入场先显式配置时钟。advance-rules 采用已配置规律；advance 投影实际原生机会。配置、入场和日历修改使用完整 JSON 文件或标准输入。";
  static args = {
    operation: Args.string({ required: true, options: Object.keys(worldOperations) }),
  };
  static flags = {
    "subject-id": Flags.string({ description: "当前绑定 Subject UUID" }),
    "world-id": Flags.string({ description: "世界 UUID" }),
    "calendar-view": Flags.string({
      options: ["planned", "lived", "combined"],
      default: "combined",
    }),
    perspective: Flags.string({
      options: ["subject", "world_author", "public"],
      default: "subject",
    }),
    timezone: Flags.string({ description: "日历显示 IANA 时区，如 Asia/Shanghai" }),
    "actor-ref": Flags.string({ description: "日历筛选实际人物 EntityRef" }),
    continuation: Flags.string({ description: "上一页返回的日历 continuation" }),
    domain: Flags.string({ description: "正式 timeDomainRef" }),
    from: Flags.string({ description: "所查世界区间起点（UTC ISO）" }),
    to: Flags.string({ description: "所查世界区间终点（UTC ISO，不含）" }),
    view: Flags.string({
      options: ["subject", "world_author"],
      default: "subject",
      description: "主体见闻或管理者世界视角",
    }),
    limit: Flags.integer({ min: 1, max: 128, default: 50 }),
    "as-recorded-at": Flags.string({ description: "现实数据库记录截点（UTC ISO）" }),
    "knowledge-at": Flags.string({ description: "故事内角色知情世界点（UTC ISO）" }),
    "after-event-id": Flags.string(),
    "after-revision": Flags.integer({ min: 0 }),
    "actor-key": Flags.string({
      description: "世界内稳定人物 key，不使用昵称猜测身份",
    }),
    "entity-ref": Flags.string({
      multiple: true,
      description: "核对在该世界登记的 canonical EntityRef",
    }),
    "activity-id": Flags.string(),
    "request-id": Flags.string({ description: "显式原生机会幂等 UUID" }),
    file: Flags.string({
      exclusive: ["stdin"],
      description: "configure/realize 的完整 JSON 请求文件",
    }),
    stdin: Flags.boolean({
      exclusive: ["file"],
      description: "从标准输入读取完整 JSON 请求",
    }),
  };
  /** Executes the selected authenticated operator request. */
  async run() {
    const { flags, args } = await this.parse(World);
    const operation = args.operation as keyof typeof worldOperations;
    return this.execute(
      flags["anchor-root"],
      async (local, signal) => {
        let document: unknown;
        if (flags.file || flags.stdin) {
          try {
            if (flags.file) {
              if ((await stat(flags.file)).size > 65536) throw Error("input too large");
              document = JSON.parse(await readFile(flags.file, "utf8"));
            } else document = await readProtectedJsonFromStdin();
          } catch {
            throw new CliFailure(
              "cli.invalid_json",
              "请求必须是最多65536字节的有效 JSON 对象。",
              2,
            );
          }
        }
        if ((flags.file || flags.stdin) && !worldDocumentOperations.includes(operation))
          throw new CliFailure(
            "cli.invalid_flag",
            "只有配置、入场及日历修改使用 --file 或 --stdin；查询使用明确参数。",
            2,
          );
        const input = worldRequest(operation, flags, document),
          gateway = await openOperatorGateway(local, { signal });
        try {
          return await (
            gateway[worldOperations[operation]] as (body: never) => Promise<unknown>
          )(input as never);
        } catch (error) {
          throw toCliFailure(error);
        }
      },
      true,
    );
  }
}
