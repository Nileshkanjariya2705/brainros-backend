import { Controller, Get } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureKey } from './feature-flag.constants';

@Controller('config')
export class FeatureFlagController {
  constructor(private readonly featureFlagService: FeatureFlagService) {}

  /**
   * Public / Authenticated safe endpoint to retrieve current feature flag statuses.
   * GET /config/features
   */
  @Get('features')
  getFeatures(): {
    success: boolean;
    features: Record<FeatureKey, boolean>;
  } {
    const features = this.featureFlagService.getPublicFeatures();
    return {
      success: true,
      features,
    };
  }
}
