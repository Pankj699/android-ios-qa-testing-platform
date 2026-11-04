export const FLYER_MAKER_PACKAGE = 'com.bg.flyermaker';

/**
 * Checks whether a target build belongs to Flyer Maker based on its verified package name.
 * 
 * Strict safety rules:
 * - Returns true ONLY if build is a valid object and its normalized packageName === 'com.bg.flyermaker'.
 * - Returns false if build is null, undefined, loading, missing packageName, or belongs to another package.
 * - Does not rely on display strings or installed package status on device.
 * 
 * @param {object|null|undefined} build
 * @returns {boolean}
 */
export function isFlyerMakerBuild(build) {
  if (!build || typeof build !== 'object') return false;
  const pkg = typeof build.packageName === 'string' ? build.packageName.trim().toLowerCase() : '';
  return pkg === FLYER_MAKER_PACKAGE;
}
