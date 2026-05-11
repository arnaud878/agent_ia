import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { QueryResult } from 'pg';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { SchemaService } from '../bi/services/schema.service';

const UPLOAD_DIR = resolve(process.cwd(), 'storage/uploads');
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CONTEXT_CHARS = 6000;
const CHUNK_SIZE_CHARS = 900;
const CHUNK_OVERLAP_CHARS = 180;
const ALLOWED_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'application/xml',
  'text/xml',
  'text/html',
  'application/x-yaml',
  'text/yaml',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/heic',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
]);
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
  '.heic',
]);

export type ConversationAttachmentRow = {
  id: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

@Injectable()
export class ConversationAttachmentsService {
  constructor(
    private readonly schema: SchemaService,
    private readonly config: ConfigService,
  ) {}

  private async ensureStoreTable(): Promise<void> {
    await this.schema.executeAppQuery(`
      CREATE TABLE IF NOT EXISTS public.bi_conversation_attachments (
        id uuid PRIMARY KEY,
        conversation_id uuid NOT NULL REFERENCES public.bi_conversations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
        file_name varchar(255) NOT NULL,
        mime_type varchar(255) NOT NULL,
        size_bytes integer NOT NULL,
        storage_path text NOT NULL,
        extracted_text text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.schema.executeAppQuery(`
      CREATE TABLE IF NOT EXISTS public.bi_conversation_attachment_chunks (
        id uuid PRIMARY KEY,
        attachment_id uuid NOT NULL REFERENCES public.bi_conversation_attachments(id) ON DELETE CASCADE,
        chunk_index integer NOT NULL,
        content text NOT NULL,
        embedding jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  private sanitizeFileName(name: string): string {
    const b = basename(name || 'file');
    const cleaned = b.replace(/[^a-zA-Z0-9._-]/g, '_');
    return cleaned.slice(0, 120) || 'file';
  }

  private detectMimeFromExtension(fileName: string): string | null {
    const ext = extname(fileName).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.doc':
        return 'application/msword';
      case '.docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case '.xls':
        return 'application/vnd.ms-excel';
      case '.xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case '.ppt':
        return 'application/vnd.ms-powerpoint';
      case '.pptx':
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      case '.odt':
        return 'application/vnd.oasis.opendocument.text';
      case '.ods':
        return 'application/vnd.oasis.opendocument.spreadsheet';
      case '.odp':
        return 'application/vnd.oasis.opendocument.presentation';
      case '.rtf':
        return 'application/rtf';
      case '.txt':
        return 'text/plain';
      case '.md':
        return 'text/markdown';
      case '.csv':
        return 'text/csv';
      case '.tsv':
        return 'text/tab-separated-values';
      case '.json':
        return 'application/json';
      case '.xml':
        return 'application/xml';
      case '.yaml':
      case '.yml':
        return 'application/x-yaml';
      case '.html':
      case '.htm':
        return 'text/html';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.webp':
        return 'image/webp';
      case '.gif':
        return 'image/gif';
      case '.tif':
      case '.tiff':
        return 'image/tiff';
      case '.heic':
        return 'image/heic';
      default:
        return null;
    }
  }

  private detectMimeFromMagic(fileBuffer: Buffer): string | null {
    if (fileBuffer.length >= 5) {
      const head5 = fileBuffer.subarray(0, 5).toString('utf8');
      if (head5 === '%PDF-') {
        return 'application/pdf';
      }
    }
    if (fileBuffer.length >= 4) {
      const b0 = fileBuffer[0];
      const b1 = fileBuffer[1];
      const b2 = fileBuffer[2];
      const b3 = fileBuffer[3];
      if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) {
        // ZIP container (docx/xlsx/pptx/od*). Sans extension fiable, on tente docx.
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
    }
    const probe = fileBuffer.subarray(0, Math.min(512, fileBuffer.length));
    let printable = 0;
    for (const c of probe) {
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) {
        printable++;
      }
    }
    if (probe.length > 0 && printable / probe.length > 0.9) {
      return 'text/plain';
    }
    return null;
  }

  private async ensureConversationOwner(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const q = await this.schema.executeAppQuery(
      `SELECT 1
       FROM public.bi_conversations
       WHERE id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (!q.rows[0]) {
      throw new NotFoundException('Conversation introuvable.');
    }
  }

  private normalizeExtractedText(raw: string): string | null {
    const normalized = raw.replace(/\u0000/g, '').replace(/\s+\n/g, '\n').trim();
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, 120_000);
  }

  private async extractTextIfSupported(
    filePath: string,
    mimeType: string,
    fileBuffer: Buffer,
  ): Promise<string | null> {
    try {
      if (mimeType === 'application/pdf') {
        const parser = new PDFParse({ data: fileBuffer });
        try {
          const out = await parser.getText();
          return this.normalizeExtractedText(out.text ?? '');
        } finally {
          await parser.destroy().catch(() => {});
        }
      }
      if (
        mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const out = await mammoth.extractRawText({ buffer: fileBuffer });
        return this.normalizeExtractedText(out.value ?? '');
      }
      if (
        mimeType === 'text/plain' ||
        mimeType === 'text/markdown' ||
        mimeType === 'text/csv' ||
        mimeType === 'text/tab-separated-values' ||
        mimeType === 'application/json' ||
        mimeType === 'application/xml' ||
        mimeType === 'text/xml' ||
        mimeType === 'text/html' ||
        mimeType === 'application/x-yaml'
      ) {
        const raw = await readFile(filePath, 'utf-8');
        return this.normalizeExtractedText(raw);
      }
    } catch {
      return null;
    }
    return null;
  }

  private buildChunks(text: string): string[] {
    const input = text.trim();
    if (!input) {
      return [];
    }
    if (input.length <= CHUNK_SIZE_CHARS) {
      return [input];
    }
    const chunks: string[] = [];
    let i = 0;
    while (i < input.length) {
      const end = Math.min(input.length, i + CHUNK_SIZE_CHARS);
      const part = input.slice(i, end).trim();
      if (part.length > 0) {
        chunks.push(part);
      }
      if (end >= input.length) {
        break;
      }
      i = Math.max(0, end - CHUNK_OVERLAP_CHARS);
    }
    return chunks.slice(0, 60);
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    let provider: 'gemini' | 'gpt' | 'claude' = 'gemini';
    let dbApiKey = '';
    try {
      const r = await this.schema.executeAppQuery(
        `SELECT provider, api_key AS "apiKey"
         FROM public.bi_llm_settings
         WHERE id = true`,
      );
      const row = r.rows[0] as
        | { provider?: 'gemini' | 'gpt' | 'claude'; apiKey?: string | null }
        | undefined;
      if (row?.provider) {
        provider = row.provider;
      }
      dbApiKey = String(row?.apiKey ?? '').trim();
    } catch {
      // Ignore read error and use env fallback.
    }
    const googleKey = dbApiKey || (this.config.get<string>('GOOGLE_API_KEY') ?? '').trim();
    const openaiKey = dbApiKey || (this.config.get<string>('OPENAI_API_KEY') ?? '').trim();

    try {
      if (provider === 'gpt' && openaiKey) {
        const embed = new OpenAIEmbeddings({
          apiKey: openaiKey,
          model: 'text-embedding-3-small',
        });
        return await embed.embedDocuments(texts);
      }
      if (googleKey) {
        const embed = new GoogleGenerativeAIEmbeddings({
          apiKey: googleKey,
          model: 'text-embedding-004',
        });
        return await embed.embedDocuments(texts);
      }
    } catch {
      // Fallback local below.
    }
    return texts.map((t) => this.localEmbeddingVector(t));
  }

  private localEmbeddingVector(text: string): number[] {
    // Fallback déterministe: garantit un embedding non-vide même sans API externe.
    const v = new Array<number>(64).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const idx = i % 64;
      v[idx] = (v[idx] ?? 0) + (code % 97) / 97;
    }
    let norm = 0;
    for (const x of v) {
      norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) {
      return -1;
    }
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      dot += av * bv;
      na += av * av;
      nb += bv * bv;
    }
    if (na <= 0 || nb <= 0) {
      return -1;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  async listForConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationAttachmentRow[]> {
    await this.ensureStoreTable();
    await this.ensureConversationOwner(userId, conversationId);
    const r = (await this.schema.executeAppQuery(
      `SELECT
         id,
         conversation_id AS "conversationId",
         file_name AS "fileName",
         mime_type AS "mimeType",
         size_bytes AS "sizeBytes",
         created_at AS "createdAt"
       FROM public.bi_conversation_attachments
       WHERE conversation_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [conversationId, userId],
    )) as QueryResult<ConversationAttachmentRow>;
    return r.rows ?? [];
  }

  async createForConversation(
    userId: string,
    conversationId: string,
    file: {
      size: number;
      mimetype: string;
      originalname: string;
      buffer: Buffer;
    } | undefined,
  ): Promise<ConversationAttachmentRow> {
    await this.ensureStoreTable();
    await this.ensureConversationOwner(userId, conversationId);
    if (!file) {
      throw new BadRequestException('Fichier manquant.');
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('Fichier vide ou trop volumineux (20MB max).');
    }
    const mimeType = (file.mimetype || '').toLowerCase();
    const safeName = this.sanitizeFileName(file.originalname);
    const fileExt = extname(safeName).toLowerCase();
    const effectiveMime =
      mimeType === 'application/octet-stream' || !ALLOWED_MIME_TYPES.has(mimeType)
        ? (this.detectMimeFromExtension(safeName) ??
          this.detectMimeFromMagic(file.buffer) ??
          mimeType)
        : mimeType;
    if (
      !ALLOWED_MIME_TYPES.has(effectiveMime) &&
      !ALLOWED_EXTENSIONS.has(fileExt)
    ) {
      throw new BadRequestException(
        `Type de fichier non supporté: ${mimeType} (${fileExt || 'sans extension'})`,
      );
    }

    const id = randomUUID();
    const subDir = join(UPLOAD_DIR, conversationId);
    await mkdir(subDir, { recursive: true });
    const filePath = join(subDir, `${id}${extname(safeName) || ''}`);
    await writeFile(filePath, file.buffer);
    const extractedText = await this.extractTextIfSupported(
      filePath,
      effectiveMime,
      file.buffer,
    );

    const ins = (await this.schema.executeAppQuery(
      `INSERT INTO public.bi_conversation_attachments
         (id, conversation_id, user_id, file_name, mime_type, size_bytes, storage_path, extracted_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         id,
         conversation_id AS "conversationId",
         file_name AS "fileName",
         mime_type AS "mimeType",
         size_bytes AS "sizeBytes",
         created_at AS "createdAt"`,
      [
        id,
        conversationId,
        userId,
        safeName,
        effectiveMime,
        file.size,
        filePath,
        extractedText,
      ],
    )) as QueryResult<ConversationAttachmentRow>;
    if (extractedText && extractedText.trim().length > 0) {
      const chunks = this.buildChunks(extractedText);
      const vectors = await this.embedTexts(chunks);
      const canUseVectors = vectors.length === chunks.length && vectors.length > 0;
      for (let i = 0; i < chunks.length; i++) {
        await this.schema.executeAppQuery(
          `INSERT INTO public.bi_conversation_attachment_chunks
             (id, attachment_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            randomUUID(),
            id,
            i,
            chunks[i],
            JSON.stringify(
              canUseVectors ? vectors[i] : this.localEmbeddingVector(chunks[i]!),
            ),
          ],
        );
      }
    }
    return ins.rows[0]!;
  }

  async removeForConversation(
    userId: string,
    conversationId: string,
    attachmentId: string,
  ): Promise<void> {
    await this.ensureStoreTable();
    await this.ensureConversationOwner(userId, conversationId);
    const sel = await this.schema.executeAppQuery(
      `SELECT storage_path AS "storagePath"
       FROM public.bi_conversation_attachments
       WHERE id = $1 AND conversation_id = $2 AND user_id = $3`,
      [attachmentId, conversationId, userId],
    );
    const row = sel.rows[0] as { storagePath: string } | undefined;
    if (!row) {
      throw new NotFoundException('Pièce jointe introuvable.');
    }
    await this.schema.executeAppQuery(
      `DELETE FROM public.bi_conversation_attachments
       WHERE id = $1 AND conversation_id = $2 AND user_id = $3`,
      [attachmentId, conversationId, userId],
    );
    await unlink(row.storagePath).catch(() => {});
  }

  async purgeFilesForConversation(conversationId: string): Promise<void> {
    await this.ensureStoreTable();
    const rows = await this.schema.executeAppQuery(
      `SELECT storage_path AS "storagePath"
       FROM public.bi_conversation_attachments
       WHERE conversation_id = $1`,
      [conversationId],
    );
    for (const row of rows.rows as { storagePath: string }[]) {
      await unlink(row.storagePath).catch(() => {});
    }
    await rm(join(UPLOAD_DIR, conversationId), { recursive: true, force: true }).catch(
      () => {},
    );
  }

  async buildContextForPrompt(input: {
    userId: string;
    conversationId: string;
    attachmentIds: string[];
    query: string;
  }): Promise<string | null> {
    await this.ensureStoreTable();
    await this.ensureConversationOwner(input.userId, input.conversationId);
    const ids = [...new Set(input.attachmentIds)].filter((id) => id.length > 0);
    if (ids.length === 0) {
      return null;
    }
    const attachments = (await this.schema.executeAppQuery(
      `SELECT id, file_name AS "fileName", mime_type AS "mimeType", storage_path AS "storagePath", extracted_text AS "extractedText"
       FROM public.bi_conversation_attachments
       WHERE conversation_id = $1 AND user_id = $2 AND id = ANY($3::uuid[])`,
      [input.conversationId, input.userId, ids],
    )) as QueryResult<{
      id: string;
      fileName: string;
      mimeType: string;
      storagePath: string;
      extractedText: string | null;
    }>;
    if (!attachments.rows.length) {
      return null;
    }

    for (const a of attachments.rows) {
      const hasChunks = await this.schema.executeAppQuery(
        `SELECT 1 FROM public.bi_conversation_attachment_chunks WHERE attachment_id = $1 LIMIT 1`,
        [a.id],
      );
      if (hasChunks.rows.length > 0) {
        continue;
      }
      try {
        const buf = await readFile(a.storagePath);
        const detectedMime =
          a.mimeType === 'application/octet-stream'
            ? (this.detectMimeFromExtension(a.fileName) ??
              this.detectMimeFromMagic(buf) ??
              a.mimeType)
            : a.mimeType;
        const text =
          a.extractedText && a.extractedText.trim().length > 0
            ? a.extractedText
            : await this.extractTextIfSupported(a.storagePath, detectedMime, buf);
        if (!text || !text.trim()) {
          continue;
        }
        await this.schema.executeAppQuery(
          `UPDATE public.bi_conversation_attachments
           SET mime_type = $2, extracted_text = $3
           WHERE id = $1`,
          [a.id, detectedMime, text],
        );
        const chunks = this.buildChunks(text);
        const vectors = await this.embedTexts(chunks);
        const canUseVectors = vectors.length === chunks.length && vectors.length > 0;
        for (let i = 0; i < chunks.length; i++) {
          await this.schema.executeAppQuery(
            `INSERT INTO public.bi_conversation_attachment_chunks
               (id, attachment_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [
              randomUUID(),
              a.id,
              i,
              chunks[i],
              JSON.stringify(
                canUseVectors ? vectors[i] : this.localEmbeddingVector(chunks[i]!),
              ),
            ],
          );
        }
      } catch {
        // Ignore reindex errors; context fallback below still works.
      }
    }

    const q = (await this.schema.executeAppQuery(
      `SELECT a.id, a.file_name AS "fileName", c.id AS "chunkId", c.content, c.embedding
       FROM public.bi_conversation_attachments a
       JOIN public.bi_conversation_attachment_chunks c ON c.attachment_id = a.id
       WHERE a.conversation_id = $1 AND a.user_id = $2 AND a.id = ANY($3::uuid[])`,
      [input.conversationId, input.userId, ids],
    )) as QueryResult<{
      id: string;
      fileName: string;
      chunkId: string;
      content: string;
      embedding: number[] | string;
    }>;
    const contextHeader = [
      'Contexte des pièces jointes sélectionnées :',
      ...attachments.rows.map(
        (a) => `- ${a.fileName} (${a.mimeType})`,
      ),
    ];
    if (!q.rows.length) {
      contextHeader.push(
        "Aucun extrait textuel n'est encore disponible pour ces fichiers. Réponds en demandant une extraction OCR/parser avancée si nécessaire.",
      );
      return contextHeader.join('\n');
    }

    const queryVecs = await this.embedTexts([input.query.trim()]);
    if (!queryVecs.length) {
      contextHeader.push(
        "Embeddings indisponibles actuellement. Utilise la liste des fichiers joints et demande le type d'analyse souhaité.",
      );
      return contextHeader.join('\n');
    }
    const qVec = queryVecs[0]!;
    const qLocalVec = this.localEmbeddingVector(input.query);
    const queryTerms = new Set(
      input.query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((x) => x.trim())
        .filter((x) => x.length >= 3),
    );
    const ranked = q.rows
      .map((row) => {
        let emb =
          typeof row.embedding === 'string'
            ? (JSON.parse(row.embedding) as number[])
            : (row.embedding as number[]);
        if (!Array.isArray(emb) || emb.length === 0) {
          emb = this.localEmbeddingVector(row.content);
          void this.schema.executeAppQuery(
            `UPDATE public.bi_conversation_attachment_chunks
             SET embedding = $2::jsonb
             WHERE id = $1`,
            [row.chunkId, JSON.stringify(emb)],
          );
        }
        let score = -1;
        if (emb.length === qVec.length) {
          score = this.cosineSimilarity(qVec, emb);
        } else if (emb.length === qLocalVec.length) {
          score = this.cosineSimilarity(qLocalVec, emb);
        } else {
          const contentTerms = new Set(
            row.content
              .toLowerCase()
              .split(/[^a-z0-9]+/i)
              .map((x) => x.trim())
              .filter((x) => x.length >= 3),
          );
          let overlap = 0;
          for (const t of queryTerms) {
            if (contentTerms.has(t)) {
              overlap++;
            }
          }
          score = overlap / Math.max(1, queryTerms.size);
        }
        return {
          fileName: row.fileName,
          content: row.content,
          score,
        };
      })
      .filter((x) => Number.isFinite(x.score) && x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    if (!ranked.length) {
      contextHeader.push(
        'Aucun passage pertinent extrait automatiquement. Appuie-toi sur la présence des fichiers joints et demande précision.',
      );
      return contextHeader.join('\n');
    }

    let budget = MAX_TEXT_CONTEXT_CHARS;
    const lines: string[] = [...contextHeader, 'Extraits pertinents :'];
    for (const row of ranked) {
      if (budget <= 0) {
        break;
      }
      const excerpt = row.content.trim().slice(0, Math.min(1200, budget));
      lines.push(`- ${row.fileName} (score=${row.score.toFixed(3)}): ${excerpt}`);
      budget -= excerpt.length;
    }
    return lines.join('\n');
  }
}

