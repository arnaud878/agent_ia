import { Module } from '@nestjs/common';
import { BiAgentService } from './bi-agent.service';
import { BiPromptService } from './bi-prompt.service';
import { ChatHistoryService } from './chat-history.service';
import { SchemaService } from './schema.service';

@Module({
  providers: [
    SchemaService,
    BiPromptService,
    ChatHistoryService,
    BiAgentService,
  ],
  exports: [SchemaService, BiAgentService, BiPromptService, ChatHistoryService],
})
export class BiModule {}
