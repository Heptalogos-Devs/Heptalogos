// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shares native systemd value quoting across installed Gateway services.
 * @module service-unit
 */
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { runProcessSync } from "@heptalogos/repo-kit";

/** An omitted choice preserves systemd's current setting; new installs pass false. */
export function registerService(unitPath, autostart) {
  const invoke = (args, checked = true) => {
    const result = runProcessSync("systemctl", ["--user", ...args], {
      timeout: 10000,
      stdin: "ignore",
    });
    if (checked && result.exitCode !== 0)
      throw Error("The user service manager could not register the installed service");
    return result;
  };
  const unit = basename(unitPath);
  const current = invoke(["is-enabled", unit], false).stdout?.trim();
  const enabled = autostart ?? ["enabled", "enabled-runtime"].includes(current);
  if (!enabled && ["enabled", "enabled-runtime"].includes(current))
    invoke(["disable", unit]);
  invoke([autostart === true ? "enable" : "link", unitPath]);
  invoke(["daemon-reload"]);
  return enabled;
}

/** CLI spelling shared by installation and the two Gateway configuration commands. */
export function autostartChoice(value) {
  if (value === undefined) return undefined;
  if (!["yes", "no"].includes(value)) throw Error("--autostart requires yes or no");
  return value === "yes";
}

/** Quotes a native systemd unit value without invoking a shell. */
export function quoteUnit(value, command = false) {
  if (/[\r\n\0]/u.test(value))
    throw new Error("A service path contains unsupported control characters");
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%");
  return `"${command ? escaped.replaceAll("$", () => "$$") : escaped}"`;
}

/** Reads the single installer-owned locator and service descriptor without selecting or changing a slot. */
export async function readInstallationServices(target) {
  const locator = JSON.parse(
    await readFile(join(target, "heptalogos.bootstrap.json"), "utf8"),
  );
  const descriptorPath = join(
    locator.roots.CONFIGURATION,
    "installation-services.json",
  );
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  return { locator, descriptorPath, descriptor };
}
