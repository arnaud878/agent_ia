import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { BiDataTablesService } from '../../common/bi-tables/bi-data-tables.service';
import type { DataAccess } from '../../common/types/data-access';
import { SchemaService } from '../bi/services/schema.service';

export type AuthUserPayload = {
  id: string;
  email: string;
  roleSlug: string;
  active: boolean;
};

const BCRYPT_ROUNDS = 10;

@Injectable()
export class IamService implements OnModuleInit {
  private readonly log = new Logger(IamService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly schema: SchemaService,
    private readonly biTables: BiDataTablesService,
  ) {}

  async onModuleInit() {
    await this.bootstrapAdminIfConfigured();
  }

  private async bootstrapAdminIfConfigured() {
    const email = this.config.get<string>('BOOTSTRAP_ADMIN_EMAIL')?.trim();
    const pass = this.config.get<string>('BOOTSTRAP_ADMIN_PASSWORD');
    if (!email || !pass) {
      return;
    }
    const existing = await this.findUserByEmail(email);
    if (existing) {
      return;
    }
    const roleId = await this.findRoleIdBySlug('admin');
    if (!roleId) {
      this.log.warn(
        'BOOTSTRAP_ADMIN_* défini mais rôle admin introuvable — exécuter la migration auth_rbac.',
      );
      return;
    }
    await this.createUserInternal(email, pass, roleId);
    this.log.log(`Compte admin bootstrap créé : ${email}`);
  }

  async findByIdForAuth(id: string): Promise<AuthUserPayload | null> {
    const rows = await this.schema.executeAppQuery(
      `SELECT u.id, u.email, u.active, r.slug AS "roleSlug"
       FROM public.app_users u
       JOIN public.app_roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [id],
    );
    const r = rows.rows[0] as
      | { id: string; email: string; active: boolean; roleSlug: string }
      | undefined;
    if (!r) {
      return null;
    }
    return {
      id: r.id,
      email: r.email,
      roleSlug: r.roleSlug,
      active: r.active,
    };
  }

  async getDataAccessForUserId(userId: string): Promise<DataAccess | null> {
    const rows = await this.schema.executeAppQuery(
      `SELECT u.active, r.access_all_tables AS "accessAll"
       FROM public.app_users u
       JOIN public.app_roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [userId],
    );
    const base = rows.rows[0] as
      | { active: boolean; accessAll: boolean }
      | undefined;
    if (!base || !base.active) {
      return null;
    }
    if (base.accessAll) {
      return { kind: 'all' };
    }
    const t = await this.schema.executeAppQuery(
      `SELECT art.table_name AS "tableName"
       FROM public.app_users u
       JOIN public.app_role_tables art ON art.role_id = u.role_id
       WHERE u.id = $1`,
      [userId],
    );
    const names = (t.rows as { tableName: string }[])
      .map((x) => x.tableName)
      .filter((n) => this.biTables.isBiDataTableName(n));
    if (names.length === 0) {
      return { kind: 'restricted', tableNames: [] };
    }
    return { kind: 'restricted', tableNames: names };
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthUserPayload | null> {
    const rows = await this.schema.executeAppQuery(
      `SELECT u.id, u.email, u.password_hash AS "passwordHash", u.active, r.slug AS "roleSlug"
       FROM public.app_users u
       JOIN public.app_roles r ON r.id = u.role_id
       WHERE lower(u.email) = lower($1)`,
      [email.trim()],
    );
    const r = rows.rows[0] as
      | {
          id: string;
          email: string;
          passwordHash: string;
          active: boolean;
          roleSlug: string;
        }
      | undefined;
    if (!r || !r.active) {
      return null;
    }
    const ok = await bcrypt.compare(password, r.passwordHash);
    if (!ok) {
      return null;
    }
    return {
      id: r.id,
      email: r.email,
      roleSlug: r.roleSlug,
      active: r.active,
    };
  }

  async findUserByEmail(email: string) {
    const res = await this.schema.executeAppQuery(
      `SELECT id FROM public.app_users WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    return res.rows[0] as { id: string } | undefined;
  }

  async findRoleIdBySlug(slug: string): Promise<string | null> {
    const res = await this.schema.executeAppQuery(
      `SELECT id FROM public.app_roles WHERE slug = $1`,
      [slug],
    );
    const row = res.rows[0] as { id: string } | undefined;
    return row?.id ?? null;
  }

  private async createUserInternal(
    email: string,
    password: string,
    roleId: string,
  ): Promise<string> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const res = await this.schema.executeAppQuery(
      `INSERT INTO public.app_users (email, password_hash, role_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email.trim().toLowerCase(), passwordHash, roleId],
    );
    return String((res.rows[0] as { id: string }).id);
  }

  async createUser(
    email: string,
    password: string,
    roleId: string,
  ): Promise<{ id: string }> {
    if (password.length < 8) {
      throw new BadRequestException('Mot de passe : 8 caractères minimum');
    }
    const ex = await this.findUserByEmail(email);
    if (ex) {
      throw new BadRequestException('Email déjà utilisé');
    }
    const id = await this.createUserInternal(email, password, roleId);
    return { id };
  }

  async listRoles() {
    const r = await this.schema.executeAppQuery(
      `SELECT r.id, r.name, r.slug, r.description, r.access_all_tables AS "accessAll", r.created_at AS "createdAt"
       FROM public.app_roles r
       ORDER BY r.name`,
    );
    const tables = await this.schema.executeAppQuery(
      `SELECT role_id AS "roleId", table_name AS "tableName" FROM public.app_role_tables`,
    );
    const byRole = new Map<string, string[]>();
    for (const row of tables.rows as { roleId: string; tableName: string }[]) {
      const list = byRole.get(row.roleId) ?? [];
      list.push(row.tableName);
      byRole.set(row.roleId, list);
    }
    return r.rows.map((row) => {
      const id = String(row['id']);
      return {
        ...row,
        tables: byRole.get(id) ?? [],
      };
    });
  }

  async createRole(
    name: string,
    slug: string,
    accessAllTables: boolean,
    description: string | null,
  ) {
    const res = await this.schema.executeAppQuery(
      `INSERT INTO public.app_roles (name, slug, description, access_all_tables)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, description, access_all_tables AS "accessAll"`,
      [name, slug, description, accessAllTables],
    );
    return res.rows[0];
  }

  async setRoleTables(roleId: string, tableNames: string[]) {
    for (const t of tableNames) {
      if (!this.biTables.isBiDataTableName(t)) {
        throw new BadRequestException(`Table inconnue ou non autorisée : ${t}`);
      }
    }
    await this.schema.executeAppQuery(
      `DELETE FROM public.app_role_tables WHERE role_id = $1`,
      [roleId],
    );
    for (const t of tableNames) {
      await this.schema.executeAppQuery(
        `INSERT INTO public.app_role_tables (role_id, table_name) VALUES ($1, $2)`,
        [roleId, t],
      );
    }
    return { ok: true as const };
  }

  async listUsers() {
    const r = await this.schema.executeAppQuery(
      `SELECT u.id, u.email, u.active, u.role_id AS "roleId", u.created_at AS "createdAt",
              r.slug AS "roleSlug", r.name AS "roleName"
       FROM public.app_users u
       JOIN public.app_roles r ON r.id = u.role_id
       ORDER BY u.email`,
    );
    return r.rows;
  }

  private async getUserRowById(
    id: string,
  ): Promise<{
    id: string;
    email: string;
    roleId: string;
    active: boolean;
    passwordHash: string;
  } | null> {
    const r = await this.schema.executeAppQuery(
      `SELECT u.id, u.email, u.role_id AS "roleId", u.active,
              u.password_hash AS "passwordHash"
       FROM public.app_users u
       WHERE u.id = $1`,
      [id],
    );
    const row = r.rows[0] as
      | {
          id: string;
          email: string;
          roleId: string;
          active: boolean;
          passwordHash: string;
        }
      | undefined;
    return row ?? null;
  }

  async updateUser(
    userId: string,
    patches: { roleId?: string; active?: boolean; password?: string },
    adminUserId: string,
  ) {
    if (!patches.roleId && patches.active === undefined && !patches.password) {
      throw new BadRequestException('Aucun champ à mettre à jour');
    }
    if (patches.active === false && userId === adminUserId) {
      throw new BadRequestException(
        'Vous ne pouvez pas désactiver votre propre compte',
      );
    }
    const row = await this.getUserRowById(userId);
    if (!row) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (patches.roleId) {
      const roleCheck = await this.schema.executeAppQuery(
        `SELECT id FROM public.app_roles WHERE id = $1`,
        [patches.roleId],
      );
      if (!roleCheck.rows[0]) {
        throw new BadRequestException('Rôle introuvable');
      }
    }
    const newRoleId = patches.roleId ?? row.roleId;
    const newActive =
      patches.active !== undefined ? patches.active : row.active;
    let newHash = row.passwordHash;
    if (patches.password) {
      newHash = await bcrypt.hash(patches.password, BCRYPT_ROUNDS);
    }
    await this.schema.executeAppQuery(
      `UPDATE public.app_users
       SET role_id = $1, active = $2, password_hash = $3
       WHERE id = $4`,
      [newRoleId, newActive, newHash, userId],
    );
    return { ok: true as const };
  }

  allBiTableNamesForDocs(): string[] {
    return [...this.biTables.getAllTableNames()];
  }

  async setBiTableNames(tableNames: string[]): Promise<{ tables: string[] }> {
    try {
      const tables = await this.biTables.setAllTableNames(tableNames);
      return { tables: [...tables] };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  async getBiConnection(): Promise<{
    connectionString: string;
    dbType: 'postgresql' | 'mysql';
  }> {
    const { connectionString, dbType } =
      await this.schema.getBiConnectionSettings();
    return { connectionString: connectionString ?? '', dbType };
  }

  async setBiConnection(
    connectionString: string,
    dbType: 'postgresql' | 'mysql' = 'postgresql',
  ): Promise<{ ok: true }> {
    try {
      await this.schema.setBiConnection(connectionString, dbType);
      return { ok: true as const };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  async getLlmSettings(): Promise<{
    provider: 'gemini' | 'gpt' | 'claude';
    model: string;
    hasApiKey: boolean;
  }> {
    await this.ensureLlmSettingsTable();
    const r = await this.schema.executeAppQuery(
      `SELECT provider, model, api_key IS NOT NULL AND length(trim(api_key)) > 0 AS "hasApiKey"
       FROM public.bi_llm_settings
       WHERE id = true`,
    );
    const row = r.rows[0] as
      | { provider: 'gemini' | 'gpt' | 'claude'; model: string; hasApiKey: boolean }
      | undefined;
    if (!row) {
      return { provider: 'gemini', model: 'gemini-2.5-flash', hasApiKey: false };
    }
    return row;
  }

  async setLlmSettings(input: {
    provider: 'gemini' | 'gpt' | 'claude';
    model: string;
    apiKey?: string;
  }): Promise<{ ok: true }> {
    await this.ensureLlmSettingsTable();
    const provider = input.provider;
    const model = String(input.model || '').trim();
    if (!model) {
      throw new BadRequestException('Le modèle est obligatoire.');
    }
    const hasApiKeyField = Object.prototype.hasOwnProperty.call(input, 'apiKey');
    if (hasApiKeyField) {
      const apiKey = (input.apiKey ?? '').trim();
      await this.schema.executeAppQuery(
        `INSERT INTO public.bi_llm_settings (id, provider, model, api_key, updated_at)
         VALUES (true, $1, $2, NULLIF($3, ''), now())
         ON CONFLICT (id)
         DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model, api_key = NULLIF($3, ''), updated_at = now()`,
        [provider, model, apiKey],
      );
      return { ok: true as const };
    }
    await this.schema.executeAppQuery(
      `INSERT INTO public.bi_llm_settings (id, provider, model, updated_at)
       VALUES (true, $1, $2, now())
       ON CONFLICT (id)
       DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model, updated_at = now()`,
      [provider, model],
    );
    return { ok: true as const };
  }

  private async ensureLlmSettingsTable(): Promise<void> {
    await this.schema.executeAppQuery(`
      CREATE TABLE IF NOT EXISTS public.bi_llm_settings (
        id boolean PRIMARY KEY DEFAULT true,
        provider varchar(20) NOT NULL DEFAULT 'gemini',
        model varchar(120) NOT NULL DEFAULT 'gemini-2.5-flash',
        api_key text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT bi_llm_settings_singleton_chk CHECK (id = true),
        CONSTRAINT bi_llm_settings_provider_chk CHECK (provider IN ('gemini', 'gpt', 'claude'))
      )
    `);
  }
}
