import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { StudentModule } from './modules/student/student.module';
import { NotificationModule } from './modules/notification/notification.module';
import { InstitutionModule } from './modules/institution/institution.module';
import { AdminModule } from './modules/admin/admin.module';
import { AcademicModule } from './modules/academic/academic.module';
import { QuestionBankModule } from './modules/question-bank/question-bank.module';
import { ExamModule } from './modules/exam/exam.module';
import { ExamGeneratorModule } from './modules/exam-generator/exam-generator.module';
import { ExamSchedulingModule } from './modules/exam-scheduling/exam-scheduling.module';
import { ExamAttemptModule } from './modules/exam-attempt/exam-attempt.module';
import { TimeAnalysisModule } from './modules/time-analysis/time-analysis.module';
import { AttemptStrategyModule } from './modules/attempt-strategy/attempt-strategy.module';
import { ResultModule } from './modules/result/result.module';
import { RankEngineModule } from './modules/rank-engine/rank-engine.module';
import { PredictedRankModule } from './modules/predicted-rank/predicted-rank.module';
import { PerformanceTrendModule } from './modules/performance-trend/performance-trend.module';
import { ParentDashboardModule } from './modules/parent-dashboard/parent-dashboard.module';
import { RegionalLanguageModule } from './modules/regional-language/regional-language.module';
import { ExamSecurityModule } from './modules/exam-security/exam-security.module';
import { FeatureFlagModule } from './modules/feature-flag/feature-flag.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('REDIS_URL') || process.env.REDIS_URL;
        if (redisUrl) {
          try {
            const parsed = new URL(redisUrl);
            return {
              connection: {
                host: parsed.hostname,
                port: parseInt(parsed.port || '6379', 10),
                username: parsed.username
                  ? decodeURIComponent(parsed.username)
                  : undefined,
                password: parsed.password
                  ? decodeURIComponent(parsed.password)
                  : undefined,
                tls: redisUrl.startsWith('rediss://')
                  ? { rejectUnauthorized: false }
                  : undefined,
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                keepAlive: 30000,
                retryStrategy: (times: number) => {
                  return Math.min(times * 200, 3000);
                },
              },
            };
          } catch (e) {
            // Fallback if URL parsing fails
          }
        }

        return {
          connection: {
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
            password: process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            keepAlive: 30000,
            retryStrategy: (times: number) => {
              return Math.min(times * 200, 3000);
            },
          },
        };
      },
    }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL || '60', 10) * 1000,
        limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
      },
    ]),
    PrismaModule,
    RedisModule,
    AuthModule,
    StudentModule,
    NotificationModule,
    InstitutionModule,
    AdminModule,
    AcademicModule,
    QuestionBankModule,
    ExamModule,
    ExamGeneratorModule,
    ExamSchedulingModule,
    ExamAttemptModule,
    ExamSecurityModule,
    TimeAnalysisModule,
    AttemptStrategyModule,
    ResultModule,
    RankEngineModule,
    PredictedRankModule,
    PerformanceTrendModule,
    ParentDashboardModule,
    RegionalLanguageModule,
    FeatureFlagModule,
  ],
})
export class AppModule {}
