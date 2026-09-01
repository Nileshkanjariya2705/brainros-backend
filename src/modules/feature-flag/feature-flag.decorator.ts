import { SetMetadata } from '@nestjs/common';
import { FeatureKey } from './feature-flag.constants';

export const REQUIRE_FEATURE_KEY = 'require_feature';

/**
 * Decorator to declare that a controller or route handler requires a specific feature flag to be enabled.
 * If the feature flag is disabled, FeatureGuard blocks the request with FEATURE_DISABLED (403).
 */
export const RequireFeature = (feature: FeatureKey) =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);
