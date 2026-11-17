/**
 * A fake for a test. It names each member of T, so when T gets a new member, the
 * typecheck fails at the fake, and not at the end of a slow test run. The values
 * can be partial: a fake gives only what the test reads.
 *
 * T is the narrow type that the code under test reads (for example `AtlasGame`),
 * not the whole `Game`.
 */
export function fake<T>(members: { [K in keyof T]-?: unknown }): T {
  return members as unknown as T;
}
