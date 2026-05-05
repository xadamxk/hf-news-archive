/**
 * Normalize contributor role strings: segments joined with " / " (space-slash-space).
 * Handles leftover ";" separators and slashes without surrounding spaces.
 */
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

function normalizeRole(role: string): string {
  const segments = role.split(";").map((s) => s.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const seg of segments) {
    parts.push(...seg.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean));
  }
  return parts.join(" / ");
}

async function main() {
  const editionsDir = path.join(root, "editions");
  let rolesUpdated = 0;
  let filesUpdated = 0;
  for (const name of readdirSync(editionsDir)) {
    const fp = path.join(editionsDir, name, "events.json");
    if (!existsSync(fp)) continue;
    const raw = await readFile(fp, "utf8");
    const data = JSON.parse(raw) as { events?: { users?: { role?: string }[] }[] };
    let changed = false;
    for (const ev of data.events ?? []) {
      for (const u of ev.users ?? []) {
        if (typeof u.role !== "string" || !u.role.trim()) continue;
        const next = normalizeRole(u.role);
        if (next !== u.role) {
          u.role = next;
          rolesUpdated++;
          changed = true;
        }
      }
    }
    if (changed) {
      await writeFile(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
      filesUpdated++;
    }
  }
  console.log(`Updated ${rolesUpdated} role strings in ${filesUpdated} files`);
}

main();
