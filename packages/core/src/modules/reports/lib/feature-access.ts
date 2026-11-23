import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'

/**
 * Feature check for the reports module over an already-loaded ACL
 * snapshot. Delegates to the platform feature policy so removed / disabled
 * features deny before wildcard (`*`, `module.*`) grants match.
 */
export function hasReportFeature(userFeatures: ReadonlySet<string>, required: string): boolean {
  return authorizeFeatures([required], { grantedFeatures: Array.from(userFeatures) })
}

/** True when the user holds at least one of the listed features. */
export function hasAnyReportFeature(userFeatures: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((feature) => hasReportFeature(userFeatures, feature))
}
