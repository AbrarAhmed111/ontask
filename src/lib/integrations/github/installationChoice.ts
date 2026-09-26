// Reading an installation-choice token in the BROWSER, only to show the owner
// which GitHub accounts they can pick from. Nothing here checks the signature
// (the secret never leaves the server) -- the server verifies the token again
// when the pick is submitted (api/integrations/github/installation), so what
// this returns is for display only.
export type InstallationChoiceOption = { id: number; account: string | null }

export function readInstallationChoice(
  token: string | null,
): InstallationChoiceOption[] | null {
  const body = token?.split('.')[0]
  if (!body) return null
  try {
    const base64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64))
    if (
      payload?.kind !== 'installation_choice' ||
      !Array.isArray(payload.installations)
    )
      return null
    return payload.installations.filter(
      (item: unknown): item is InstallationChoiceOption =>
        typeof item === 'object' &&
        item !== null &&
        Number.isSafeInteger((item as { id?: unknown }).id),
    )
  } catch {
    return null
  }
}
