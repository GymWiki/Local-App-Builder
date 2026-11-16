import { realpath } from "node:fs/promises";
import path from "node:path";

export class PathError extends Error {}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Lost `rel` op binnen `root` op en weigert alles wat daar buiten valt:
 * absolute paden, `..`-segmenten, nul-bytes en symlinks die naar buiten wijzen.
 * Het doelbestand hoeft nog niet te bestaan (dan wordt de bovenliggende map gecontroleerd).
 */
export async function resolveInside(root: string, rel: string): Promise<string> {
  if (rel.includes("\0")) throw new PathError("Ongeldig pad.");
  if (path.isAbsolute(rel)) throw new PathError("Absolute paden zijn niet toegestaan.");
  const realRoot = await realpath(root);
  const lexical = path.resolve(realRoot, rel);
  if (!isInside(realRoot, lexical)) throw new PathError("Pad valt buiten de projectmap.");

  let existing = lexical;
  for (;;) {
    try {
      const real = await realpath(existing);
      const finalPath = path.join(real, path.relative(existing, lexical));
      if (!isInside(realRoot, finalPath)) throw new PathError("Pad valt buiten de projectmap (symlink).");
      return finalPath;
    } catch (e) {
      if (e instanceof PathError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(existing);
      if (parent === existing) throw new PathError("Pad valt buiten de projectmap.");
      existing = parent;
    }
  }
}
