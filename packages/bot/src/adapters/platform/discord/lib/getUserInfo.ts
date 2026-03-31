/**
 * Resolves display names for a list of user IDs via a platform-specific resolver.
 * Abstracting resolution behind resolveUser keeps this function agnostic between
 * the interaction path (self-check + guild.members.fetch) and the channel path
 * (guild.members.fetch only) — both callers supply their own resolver closure.
 */
export async function getUserInfo(
  resolveUser: (id: string) => Promise<{ name: string }>,
  userIds: string[],
): Promise<Record<string, { name: string }>> {
  const result: Record<string, { name: string }> = {};
  for (const id of userIds) {
    result[id] = await resolveUser(id);
  }
  return result;
}
