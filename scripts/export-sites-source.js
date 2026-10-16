// Source handoff only. NOT a Sites build, source sync, migration or deployment.
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2];
if (!target || !target.startsWith("/"))
  throw Error("absolute_source_checkout_required");
const destination = resolve(target);
if (destination === resolve(root))
  throw Error("separate_sites_checkout_required");
const manifestPath = resolve(destination, ".openai/hosting.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!manifest.project_id) throw Error("existing_registered_site_required");
// Preserve exact registered identity/audience; never replace the hosting manifest.
const visited = new Set();
async function copyModule(file) {
  file = resolve(file);
  if (visited.has(file)) return;
  visited.add(file);
  const name = relative(root, file);
  if (name.startsWith("..")) throw Error("source_outside_public_repository");
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (!match[1].startsWith(".")) throw Error("unsupported_worker_dependency");
    await copyModule(resolve(dirname(file), match[1]));
  }
  const out = resolve(destination, name);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, source);
}
await copyModule(resolve(root, "sites/worker.js"));
for (const name of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "src/vendor/onesub/LICENSE",
  "sites/migrations/0001_commerce.sql",
  "sites/README.md",
]) {
  const out = resolve(destination, name);
  await mkdir(dirname(out), { recursive: true });
  await copyFile(resolve(root, name), out);
}
const assets = Object.fromEntries(
  await Promise.all(
    ["/", "/app.js", "/scene.js", "/style.css"].map(async (path) => [
      path,
      await readFile(
        resolve(root, "public", path === "/" ? "index.html" : path.slice(1)),
        "utf8",
      ),
    ]),
  ),
);
await writeFile(
  resolve(destination, "sites/assets.js"),
  `// Generated from the public game UI; no external asset requests.\nexport const assets = ${JSON.stringify(assets)};\n`,
);
await mkdir(resolve(destination, "worker"), { recursive: true });
await writeFile(
  resolve(destination, "worker/index.js"),
  'import { createSitesWorker } from "../sites/worker.js";\nimport { assets } from "../sites/assets.js";\nexport default createSitesWorker({ assets });\n',
);
await writeFile(
  resolve(destination, "package.json"),
  JSON.stringify(
    { name: "rosalyn-sites-source-handoff", private: true, type: "module" },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    sourceOnly: true,
    projectId: manifest.project_id,
    modules: visited.size,
    checkout: destination,
    readyToDeploy: false,
  }),
);
