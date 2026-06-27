import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: bun run version <semver>");
  console.error("Example: bun run version 0.1.6");
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(root, "package.json");
const cargoTomlPath = resolve(root, "src-tauri", "Cargo.toml");
const cargoLockPath = resolve(root, "src-tauri", "Cargo.lock");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
packageJson.version = version;
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const cargoToml = readFileSync(cargoTomlPath, "utf8");
writeFileSync(cargoTomlPath, cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`));

const cargoLock = readFileSync(cargoLockPath, "utf8");
const updatedLock = cargoLock.replace(
  /(\[\[package\]\r?\nname = "refract"\r?\nversion = )".*"/,
  `$1"${version}"`,
);
writeFileSync(cargoLockPath, updatedLock);

console.log(`Refract version set to ${version}`);
