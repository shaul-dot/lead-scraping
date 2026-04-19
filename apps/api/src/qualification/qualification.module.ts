import { Module } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { QualificationProcessor } from './qualification.processor';

@Module({
  providers: [QualificationService, QualificationProcessor],
  exports: [QualificationService],
})
export class QualificationModule {}
