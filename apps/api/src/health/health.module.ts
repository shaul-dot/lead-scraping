import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { StatsModule } from '../stats/stats.module';
import { BudgetModule } from '../budget/budget.module';
import { SourceModule } from '../source/source.module';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [StatsModule, BudgetModule, SourceModule, AlertModule],
  controllers: [HealthController],
})
export class HealthModule {}
