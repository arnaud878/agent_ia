import type { ColumnType, Generated } from 'kysely';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Timestamp généré côté DB ; on peut le fournir à l'insert mais pas obligatoire. */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** Timestamp généré côté DB ; jamais modifiable manuellement (created_at). */
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

// ---------------------------------------------------------------------------
// Tables applicatives (base IAM / conversations)
// ---------------------------------------------------------------------------

export interface AppRoleTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  access_all_tables: Generated<boolean>;
  created_at: CreatedAt;
}

export interface AppRoleTablesTable {
  role_id: string;
  table_name: string;
}

export interface AppUserTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  role_id: string;
  active: Generated<boolean>;
  created_at: CreatedAt;
}

// ---------------------------------------------------------------------------
// Tables de configuration BI
// ---------------------------------------------------------------------------

export interface BiAllowedTablesTable {
  table_name: string;
  created_at: CreatedAt;
}

export interface BiConnectionSettingsTable {
  /** Clé singleton : toujours true */
  id: Generated<boolean>;
  connection_string: string;
  db_type: Generated<string>;
  updated_at: Timestamp;
}

export interface BiLlmSettingsTable {
  /** Clé singleton : toujours true */
  id: Generated<boolean>;
  provider: Generated<string>;
  model: Generated<string>;
  api_key: string | null;
  updated_at: Timestamp;
}

export interface BiAgentPromptsTable {
  id: string;
  file_name: string;
  label: string;
  body: Generated<string>;
  updated_at: Timestamp;
}

// ---------------------------------------------------------------------------
// Tables conversations / messages
// ---------------------------------------------------------------------------

export interface BiConversationTable {
  id: string;
  user_id: string;
  title: string | null;
  display_key: string;
  created_at: CreatedAt;
  updated_at: Timestamp;
}

export interface BiConversationMessageTable {
  id: Generated<string>;
  conversation_id: string;
  role: string;
  body_text: string | null;
  body_html: string | null;
  duration_ms: number | null;
  requete_sql: string | null;
  resultat_sql: string | null;
  created_at: CreatedAt;
}

export interface BiConversationAttachmentTable {
  id: string;
  conversation_id: string;
  user_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  extracted_text: string | null;
  created_at: CreatedAt;
}

export interface BiConversationAttachmentChunkTable {
  id: string;
  attachment_id: string;
  chunk_index: number;
  content: string;
  embedding: unknown;
  created_at: CreatedAt;
}

// ---------------------------------------------------------------------------
// Historique agent (n8n)
// ---------------------------------------------------------------------------

export interface N8nChatHistoryTable {
  id: Generated<number>;
  session_id: string;
  message: unknown;
}

// ---------------------------------------------------------------------------
// Interface globale de la base applicative
// ---------------------------------------------------------------------------

export interface AppDatabase {
  app_roles: AppRoleTable;
  app_role_tables: AppRoleTablesTable;
  app_users: AppUserTable;
  bi_allowed_tables: BiAllowedTablesTable;
  bi_connection_settings: BiConnectionSettingsTable;
  bi_llm_settings: BiLlmSettingsTable;
  bi_agent_prompts: BiAgentPromptsTable;
  bi_conversations: BiConversationTable;
  bi_conversation_messages: BiConversationMessageTable;
  bi_conversation_attachments: BiConversationAttachmentTable;
  bi_conversation_attachment_chunks: BiConversationAttachmentChunkTable;
  n8n_chat_histories_v6: N8nChatHistoryTable;
}
