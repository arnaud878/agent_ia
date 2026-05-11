import { ConfigService } from '@nestjs/config';
import { ConversationAttachmentsService } from './conversation-attachments.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  rm: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

type MockSchema = {
  executeAppQuery: jest.Mock;
};

describe('ConversationAttachmentsService', () => {
  let schema: MockSchema;
  let config: ConfigService;
  let service: ConversationAttachmentsService;

  beforeEach(() => {
    schema = {
      executeAppQuery: jest.fn(),
    };
    config = {
      get: jest.fn().mockImplementation((k: string) => {
        if (k === 'GOOGLE_API_KEY') {
          return 'fake-key';
        }
        return undefined;
      }),
    } as unknown as ConfigService;
    service = new ConversationAttachmentsService(
      schema as unknown as any,
      config,
    );
  });

  it('detecte un PDF uploadé en octet-stream sans extension et crée des chunks', async () => {
    const s = service as unknown as {
      ensureStoreTable: () => Promise<void>;
      ensureConversationOwner: (u: string, c: string) => Promise<void>;
      extractTextIfSupported: () => Promise<string | null>;
      buildChunks: (txt: string) => string[];
      embedTexts: (txt: string[]) => Promise<number[][]>;
    };

    jest.spyOn(s, 'ensureStoreTable').mockResolvedValue(undefined);
    jest
      .spyOn(s, 'ensureConversationOwner')
      .mockResolvedValue(undefined as unknown as void);
    jest.spyOn(s, 'extractTextIfSupported').mockResolvedValue('texte extrait');
    jest.spyOn(s, 'buildChunks').mockReturnValue(['c1', 'c2']);
    jest.spyOn(s, 'embedTexts').mockResolvedValue([[0.1], [0.2]]);

    schema.executeAppQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO public.bi_conversation_attachments')) {
        return Promise.resolve({
          rows: [
            {
              id: 'att-1',
              conversationId: 'conv-1',
              fileName: 'hashname',
              mimeType: params?.[4],
              sizeBytes: 100,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (sql.includes('INSERT INTO public.bi_conversation_attachment_chunks')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.createForConversation('user-1', 'conv-1', {
      size: 100,
      mimetype: 'application/octet-stream',
      originalname: 'hashname',
      buffer: Buffer.from('%PDF-1.7 some pdf content'),
    });

    const attachmentInsertCall = schema.executeAppQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO public.bi_conversation_attachments'),
    );
    expect(attachmentInsertCall).toBeDefined();
    expect(attachmentInsertCall?.[1]?.[4]).toBe('application/pdf');

    const chunkInsertCalls = schema.executeAppQuery.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO public.bi_conversation_attachment_chunks'),
    );
    expect(chunkInsertCalls).toHaveLength(2);
  });

  it('insere quand meme les chunks avec fallback embedding non vide si embeddings indisponibles', async () => {
    const s = service as unknown as {
      ensureStoreTable: () => Promise<void>;
      ensureConversationOwner: (u: string, c: string) => Promise<void>;
      extractTextIfSupported: () => Promise<string | null>;
      buildChunks: (txt: string) => string[];
      embedTexts: (txt: string[]) => Promise<number[][]>;
    };

    jest.spyOn(s, 'ensureStoreTable').mockResolvedValue(undefined);
    jest
      .spyOn(s, 'ensureConversationOwner')
      .mockResolvedValue(undefined as unknown as void);
    jest.spyOn(s, 'extractTextIfSupported').mockResolvedValue('texte extrait');
    jest.spyOn(s, 'buildChunks').mockReturnValue(['c1', 'c2', 'c3']);
    jest.spyOn(s, 'embedTexts').mockResolvedValue([]);

    schema.executeAppQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO public.bi_conversation_attachments')) {
        return Promise.resolve({
          rows: [
            {
              id: 'att-2',
              conversationId: 'conv-1',
              fileName: 'test.txt',
              mimeType: 'text/plain',
              sizeBytes: 120,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (sql.includes('INSERT INTO public.bi_conversation_attachment_chunks')) {
        // Le 5e paramètre est l'embedding json stringifié (fallback local non vide)
        const emb = JSON.parse(String(params?.[4] ?? '[]')) as number[];
        expect(Array.isArray(emb)).toBe(true);
        expect(emb.length).toBeGreaterThan(0);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.createForConversation('user-1', 'conv-1', {
      size: 120,
      mimetype: 'text/plain',
      originalname: 'test.txt',
      buffer: Buffer.from('hello'),
    });

    const chunkInsertCalls = schema.executeAppQuery.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO public.bi_conversation_attachment_chunks'),
    );
    expect(chunkInsertCalls).toHaveLength(3);
  });
});

