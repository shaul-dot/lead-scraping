import { Module } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { QualificationProcessor } from './qualification.processor';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [StatsModule],
  providers: [QualificationService, QualificationProcessor],
  exports: [QualificationService],
})
export class QualificationModule {}
