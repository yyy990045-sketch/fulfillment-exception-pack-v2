import { ConnectorError } from "./types.js";

export interface SecretResolver {
  resolve(secretRef: string): string;
}

export function validateSecretRef(value: string | undefined) {
  if (value === undefined) return;
  if (!/^[A-Z0-9_]+$/.test(value)) throw new ConnectorError("CONNECTOR_SECRET_REF_INVALID");
}

export class EnvironmentSecretResolver implements SecretResolver {
  resolve(secretRef: string) {
    validateSecretRef(secretRef);
    const value = process.env[secretRef];
    if (!value) throw new ConnectorError("CONNECTOR_SECRET_NOT_CONFIGURED", 503);
    return value;
  }
}
