import { Module } from '@nestjs/common';
import { BiAgentService } from './bi-agent.service';
import { BiPromptService } from './bi-prompt.service';
import { SchemaService } from './schema.service';

@Module({
  providers: [SchemaService, BiPromptService, BiAgentService],
  exports: [SchemaService, BiAgentService, BiPromptService],
})
export class BiModule {}
