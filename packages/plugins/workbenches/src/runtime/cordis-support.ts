/** The Cordis generation a Workbench package must peer-depend on.
 *
 * The startup check runs a candidate against this Host's Cordis and relies on
 * FiberState values, so the range has to be the generation this SDK was verified
 * with. It is a compile-time constant rather than a runtime manifest read: the
 * SDK is also loaded from bundled, non-file module URLs where no package
 * manifest can be resolved. `tests/cordis-support.test.mjs` keeps it equal to
 * the published `peerDependencies` entry, which is what consumers install. */
export const CORDIS_PEER_RANGE = '~4.1.0';

export function cordisPeerRange(): string {
  return CORDIS_PEER_RANGE;
}
