import { Controller, Post, Body } from '@nestjs/common';
import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post()
  async query(@Body() body: { question: string }) {
    return this.queryService.executeNaturalLanguageQuery(body.question);
  }
}
