import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { BudgetService } from './budget.service';

@Controller('budgets')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get()
  async getAll() {
    return this.budgetService.getAllBudgets();
  }

  @Patch(':provider/cap')
  async updateCap(
    @Param('provider') provider: string,
    @Body() body: { monthlyCapUsd: number; confirmed?: boolean },
  ) {
    if (!body.confirmed) {
      return {
        warning:
          'Updating budget caps requires Tier 3 confirmation. Set confirmed=true to proceed.',
      };
    }
    return this.budgetService.updateCap(provider, body.monthlyCapUsd);
  }
}
