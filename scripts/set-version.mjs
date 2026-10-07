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
const cargoToml = readFileSync(cargoTomlPath, "utf8");
const cargoLock = readFileSync(cargoLockPath, "utf8");
const cargoVersionPattern = /^version = ".*"$/m;
const lockVersionPattern = /(\[\[package\]\]\r?\nname = "refract"\r?\nversion = )".*"/;
// Validate both projections before writing any version file. A missed lockfile
// match otherwise leaves a partially bumped release that fails cargo --locked.
if (!cargoVersionPattern.test(cargoToml) || !lockVersionPattern.test(cargoLock)) {
  throw new Error("Unable to find the Refract version in Cargo.toml or Cargo.lock");
}
const updatedToml = cargoToml.replace(cargoVersionPattern, `version = "${version}"`);
const updatedLock = cargoLock.replace(lockVersionPattern, `$1"${version}"`);
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
writeFileSync(cargoTomlPath, updatedToml);
writeFileSync(cargoLockPath, updatedLock);

console.log(`Refract version set to ${version}`);
