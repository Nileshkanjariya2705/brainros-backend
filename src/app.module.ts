import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { StudentModule } from './modules/student/student.module';
import { AdminModule } from './modules/admin/admin.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './modules/redis/redis.module';
import { AcademicModule } from './modules/academic/academic.module';
import { QuestionBankModule } from './modules/question-bank/question-bank.module';
import { ExamModule } from './modules/exam/exam.module';
import { ExamAttemptModule } from './modules/exam-attempt/exam-attempt.module';
import { ResultModule } from './modules/result/result.module';
import { RegionalLanguageModule } from './modules/regional-language/regional-language.module';
import { ExamGeneratorModule } from './modules/exam-generator/exam-generator.module';
import { ExamSchedulingModule } from './modules/exam-scheduling/exam-scheduling.module';
import { TimeAnalysisModule } from './modules/time-analysis/time-analysis.module';
import { AttemptStrategyModule } from './modules/attempt-strategy/attempt-strategy.module';
import { RankEngineModule } from './modules/rank-engine/rank-engine.module';
import { PredictedRankModule } from './modules/predicted-rank/predicted-rank.module';
import { PerformanceTrendModule } from './modules/performance-trend/performance-trend.module';
import { ParentDashboardModule } from './modules/parent-dashboard/parent-dashboard.module';
import { InstitutionModule } from './modules/institution/institution.module';
import { NotificationModule } from './modules/notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AuthModule,
    StudentModule,
    AdminModule,
    AcademicModule,
    QuestionBankModule,
    RegionalLanguageModule,
    ExamGeneratorModule,
    ExamSchedulingModule,
    ExamModule,
    ExamAttemptModule,
    ResultModule,
    TimeAnalysisModule,
    AttemptStrategyModule,
    RankEngineModule,
    PredictedRankModule,
    PerformanceTrendModule,
    ParentDashboardModule,
    InstitutionModule,
    NotificationModule,
  ],



  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

