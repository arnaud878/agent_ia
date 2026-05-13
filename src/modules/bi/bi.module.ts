import { Module } from '@nestjs/common';
import { BiAgentPromptStoreService } from './services/bi-agent-prompt-store.service';
import { BiAgentService } from './services/bi-agent.service';
import { BiPromptService } from './services/bi-prompt.service';
import { ChatHistoryService } from './services/chat-history.service';
import { SchemaService } from './services/schema.service';

@Module({
  providers: [
    SchemaService,
    BiAgentPromptStoreService,
    BiPromptService,
    ChatHistoryService,
    BiAgentService,
  ],
  exports: [
    SchemaService,
    BiAgentService,
    BiPromptService,
    BiAgentPromptStoreService,
    ChatHistoryService,
  ],
})
export class BiModule {}
