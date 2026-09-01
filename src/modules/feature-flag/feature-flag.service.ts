import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FEATURE_KEYS,
  FEATURE_ENV_MAP,
  FEATURE_DEPENDENCIES,
  FeatureKey,
  parseBooleanFlag,
} from './feature-flag.constants';

@Injectable()
export class FeatureFlagService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.logFeatureSummary();
  }

  /**
   * Evaluates if a given feature is enabled, checking both its direct environment flag
   * and all required prerequisite feature dependencies.
   */
  isEnabled(feature: FeatureKey): boolean {
    const envVarName = FEATURE_ENV_MAP[feature];
    if (!envVarName) return false;

    const rawValue = this.configService.get<string>(envVarName);
    const directEnabled = parseBooleanFlag(rawValue);

    if (!directEnabled) {
      return false;
    }

    // Check feature dependencies
    const dependencies = FEATURE_DEPENDENCIES[feature];
    if (dependencies && dependencies.length > 0) {
      for (const parentFeature of dependencies) {
        if (!this.isEnabled(parentFeature)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Returns a clean map of public safe feature flags for frontend consumption.
   * Does NOT leak internal environment variable names or credentials.
   */
  getPublicFeatures(): Record<FeatureKey, boolean> {
    const flags: Partial<Record<FeatureKey, boolean>> = {};

    for (const key of Object.values(FEATURE_KEYS)) {
      flags[key] = this.isEnabled(key);
    }

    return flags as Record<FeatureKey, boolean>;
  }

  /**
   * Safe startup logger showing the current state of feature flags without exposing secrets.
   */
  private logFeatureSummary(): void {
    const summary = this.getPublicFeatures();
    this.logger.log('═══════════════════════════════════════════════════════════');
    this.logger.log('  BRAINROS FEATURE FLAGS INITIALIZED (ENV CONFIG)');
    this.logger.log('═══════════════════════════════════════════════════════════');
    for (const [key, enabled] of Object.entries(summary)) {
      const statusText = enabled ? '✓ ENABLED' : '✗ DISABLED';
      this.logger.log(`  [FEATURE] ${key.padEnd(25)} : ${statusText}`);
    }
    this.logger.log('═══════════════════════════════════════════════════════════');
  }
}
