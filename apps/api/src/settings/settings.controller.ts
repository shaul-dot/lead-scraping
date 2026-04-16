import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async listProviders() {
    return this.settingsService.getProviders();
  }

  @Put(':provider')
  async setApiKey(
    @Param('provider') provider: string,
    @Body() body: { apiKey: string },
  ) {
    if (!body.apiKey) {
      throw new HttpException('apiKey is required', HttpStatus.BAD_REQUEST);
    }

    try {
      await this.settingsService.setApiKey(provider, body.apiKey);
      return { success: true, message: `API key saved for ${provider}` };
    } catch (err) {
      throw new HttpException(
        err instanceof Error ? err.message : 'Failed to save API key',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':provider/test')
  async testConnection(@Param('provider') provider: string) {
    return this.settingsService.testConnection(provider);
  }
}
