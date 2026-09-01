import { Module, Global } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureGuard } from './feature-flag.guard';
import { FeatureFlagController } from './feature-flag.controller';

@Global()
@Module({
  controllers: [FeatureFlagController],
  providers: [FeatureFlagService, FeatureGuard],
  exports: [FeatureFlagService, FeatureGuard],
})
export class FeatureFlagModule {}
