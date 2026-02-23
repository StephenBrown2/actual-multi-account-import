import type { AccountRef } from "../types";

export function resolveAccountByNameOrId(
  accounts: AccountRef[],
  value?: string,
): AccountRef | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const byId = accounts.find((account) => account.id === trimmed);
  if (byId) {
    return byId;
  }
  return accounts.find((account) => account.name.toLowerCase() === trimmed.toLowerCase()) ?? null;
}
