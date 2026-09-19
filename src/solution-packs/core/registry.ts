import { SolutionPackError, type SolutionPack } from "./types.js";

export class SolutionPackRegistry {
  private readonly packs = new Map<string, SolutionPack>();

  register(pack: SolutionPack) {
    const existing = this.packs.get(pack.manifest.id);
    if (existing && existing.manifest.version !== pack.manifest.version) {
      throw new SolutionPackError("PACK_ID_VERSION_CONFLICT", 409);
    }
    if (existing && existing !== pack) throw new SolutionPackError("PACK_ID_CONFLICT", 409);
    this.packs.set(pack.manifest.id, pack);
    return pack;
  }

  get(packId: string) {
    return this.packs.get(packId);
  }

  list() {
    return [...this.packs.values()].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  }

  resolveByContextType(contextType: string) {
    const matches = this.list().filter((pack) => pack.manifest.contextTypes.includes(contextType as never));
    if (matches.length > 1) throw new SolutionPackError("PACK_CONTEXT_TYPE_AMBIGUOUS", 409);
    return matches[0];
  }
}

export const solutionPackRegistry = new SolutionPackRegistry();
