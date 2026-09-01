import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagService } from './feature-flag.service';
import { REQUIRE_FEATURE_KEY } from './feature-flag.decorator';
import { FeatureKey } from './feature-flag.constants';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeature = this.reflector.getAllAndOverride<FeatureKey>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no feature requirement metadata is found on the endpoint/controller, allow through
    if (!requiredFeature) {
      return true;
    }

    const isEnabled = this.featureFlagService.isEnabled(requiredFeature);

    if (!isEnabled) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'FEATURE_DISABLED',
        message: `This feature is currently unavailable.`,
        feature: requiredFeature,
      });
    }

    return true;
  }
}
