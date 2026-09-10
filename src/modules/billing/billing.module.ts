import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { JobProgressModule } from '../job-progress/job-progress.module';
import { BillingController } from './controllers/billing.controller';
import { BillingService } from './services/billing.service';
import { BillPdfService } from './services/bill-pdf.service';
import { BillEmailProcessor } from './processors/bill-email.processor';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    AdminModule,
    JobProgressModule,
    BullModule.registerQueue({
      name: 'bill-email',
    }),
  ],
  controllers: [BillingController],
  providers: [BillingService, BillPdfService, BillEmailProcessor],
  exports: [BillingService, BillPdfService],
})
export class BillingModule {}
