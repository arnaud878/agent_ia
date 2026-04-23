import { Module } from '@nestjs/common';
import { BiAgentService } from './services/bi-agent.service';
import { BiPromptService } from './services/bi-prompt.service';
import { ChatHistoryService } from './services/chat-history.service';
import { SchemaService } from './services/schema.service';

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
