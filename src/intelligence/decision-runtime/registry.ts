import { DecisionRuntimeError, type DecisionRuntimeProvider } from "./types.js";

export class DecisionProviderRegistry {
  private readonly providers = new Map<string, DecisionRuntimeProvider>();

  register(provider: DecisionRuntimeProvider) {
    const existing = this.providers.get(provider.name);
    if (existing && existing.model !== provider.model) throw new DecisionRuntimeError("DECISION_PROVIDER_ID_CONFLICT", 409);
    if (existing && existing !== provider) throw new DecisionRuntimeError("DECISION_PROVIDER_ID_CONFLICT", 409);
    this.providers.set(provider.name, provider);
    return provider;
  }

  get(name: string) {
    return this.providers.get(name);
  }

  list() {
    return [...this.providers.values()];
  }
}

export const decisionProviderRegistry = new DecisionProviderRegistry();
