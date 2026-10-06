// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

process.send?.({
  type: "identity",
  pid: process.pid,
  startedAtMs: Date.now() - process.uptime() * 1000,
});

process.on("message", (message) => {
  if (message?.type === "stop") process.exit(0);
});
