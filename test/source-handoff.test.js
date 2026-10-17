import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("source handoff includes client/outbox/migration and preserves a synthetic private manifest and MIT notice", () => {
  const dir = mkdtempSync(join(tmpdir(), "gca-source-fixture-"));
  try {
    mkdirSync(join(dir, ".openai"));
    const manifest = JSON.stringify({
      project_id: "synthetic-test-only",
      visibility: "private",
      version: 2,
    });
    writeFileSync(join(dir, ".openai/hosting.json"), manifest);
    execFileSync(process.execPath, ["scripts/export-sites-source.js", dir], {
      cwd: new URL("../", import.meta.url),
      stdio: "pipe",
    });
    assert.equal(
      readFileSync(join(dir, ".openai/hosting.json"), "utf8"),
      manifest,
    );
    for (const file of [
      "sites/outbox.js",
      "src/outbox.js",
      "src/events.js",
      "src/equip-request.js",
      "sites/migrations/0003_equip_requests.sql",
    ])
      assert.equal(existsSync(join(dir, file)), true, file);
    assert.match(
      readFileSync(join(dir, "sites/assets.js"), "utf8"),
      /game-client\.js/,
    );
    assert.equal(
      readFileSync(join(dir, "src/vendor/onesub/LICENSE"), "utf8"),
      readFileSync(
        new URL("../src/vendor/onesub/LICENSE", import.meta.url),
        "utf8",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
