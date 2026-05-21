import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { sql } from 'kysely';
import { AppDbService } from '../../common/db/app-db.service';
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
    private readonly appDb: AppDbService,
    private readonly schema: SchemaService,
    private readonly biTables: BiDataTablesService,
  ) {}

  async onModuleInit() {
    await this.bootstrapAdminIfConfigured();
  }

  private async bootstrapAdminIfConfigured() {
    const email = this.config.get<string>('BOOTSTRAP_ADMIN_EMAIL')?.trim();
    const pass = this.config.get<string>('BOOTSTRAP_ADMIN_PASSWORD');
    if (!email || !pass) return;
    const existing = await this.findUserByEmail(email);
    if (existing) return;
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
    const row = await this.appDb.db
      .selectFrom('app_users as u')
      .innerJoin('app_roles as r', 'r.id', 'u.role_id')
      .select(['u.id', 'u.email', 'u.active', 'r.slug as roleSlug'])
      .where('u.id', '=', id)
      .executeTakeFirst();

    if (!row) return null;
    return {
      id: String(row.id),
      email: String(row.email),
      roleSlug: String(row.roleSlug),
      active: Boolean(row.active),
    };
  }

  async getDataAccessForUserId(userId: string): Promise<DataAccess | null> {
    const base = await this.appDb.db
      .selectFrom('app_users as u')
      .innerJoin('app_roles as r', 'r.id', 'u.role_id')
      .select(['u.active', 'r.access_all_tables as accessAll'])
      .where('u.id', '=', userId)
      .executeTakeFirst();

    if (!base || !base.active) return null;
    if (base.accessAll) return { kind: 'all' };

    const tables = await this.appDb.db
      .selectFrom('app_users as u')
      .innerJoin('app_role_tables as art', 'art.role_id', 'u.role_id')
      .select('art.table_name as tableName')
      .where('u.id', '=', userId)
      .execute();

    const names = tables
      .map((x) => String(x.tableName))
      .filter((n) => this.biTables.isBiDataTableName(n));

    return { kind: 'restricted', tableNames: names };
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthUserPayload | null> {
    const row = await this.appDb.db
      .selectFrom('app_users as u')
      .innerJoin('app_roles as r', 'r.id', 'u.role_id')
      .select([
        'u.id',
        'u.email',
        'u.password_hash as passwordHash',
        'u.active',
        'r.slug as roleSlug',
      ])
      .where(sql`lower(u.email)`, '=', email.trim().toLowerCase())
      .executeTakeFirst();

    if (!row || !row.active) return null;
    const ok = await bcrypt.compare(password, String(row.passwordHash));
    if (!ok) return null;
    return {
      id: String(row.id),
      email: String(row.email),
      roleSlug: String(row.roleSlug),
      active: Boolean(row.active),
    };
  }

  async findUserByEmail(email: string) {
    return this.appDb.db
      .selectFrom('app_users')
      .select('id')
      .where(sql`lower(email)`, '=', email.trim().toLowerCase())
      .executeTakeFirst();
  }

  async findRoleIdBySlug(slug: string): Promise<string | null> {
    const row = await this.appDb.db
      .selectFrom('app_roles')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();
    return row ? String(row.id) : null;
  }

  private async createUserInternal(
    email: string,
    password: string,
    roleId: string,
  ): Promise<string> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const row = await this.appDb.db
      .insertInto('app_users')
      .values({
        email: email.trim().toLowerCase(),
        password_hash: passwordHash,
        role_id: roleId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
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
    if (ex) throw new BadRequestException('Email déjà utilisé');
    const id = await this.createUserInternal(email, password, roleId);
    return { id };
  }

  async listRoles() {
    const roles = await this.appDb.db
      .selectFrom('app_roles as r')
      .select([
        'r.id',
        'r.name',
        'r.slug',
        'r.description',
        'r.access_all_tables as accessAll',
        'r.created_at as createdAt',
      ])
      .orderBy('r.name', 'asc')
      .execute();

    const tableMappings = await this.appDb.db
      .selectFrom('app_role_tables')
      .select(['role_id as roleId', 'table_name as tableName'])
      .execute();

    const byRole = new Map<string, string[]>();
    for (const row of tableMappings) {
      const list = byRole.get(String(row.roleId)) ?? [];
      list.push(String(row.tableName));
      byRole.set(String(row.roleId), list);
    }

    return roles.map((r) => ({
      ...r,
      tables: byRole.get(String(r.id)) ?? [],
    }));
  }

  async createRole(
    name: string,
    slug: string,
    accessAllTables: boolean,
    description: string | null,
  ) {
    return this.appDb.db
      .insertInto('app_roles')
      .values({ name, slug, description, access_all_tables: accessAllTables })
      .returning(['id', 'name', 'slug', 'description', 'access_all_tables as accessAll'])
      .executeTakeFirstOrThrow();
  }

  async setRoleTables(roleId: string, tableNames: string[]) {
    for (const t of tableNames) {
      if (!this.biTables.isBiDataTableName(t)) {
        throw new BadRequestException(`Table inconnue ou non autorisée : ${t}`);
      }
    }
    await this.appDb.db
      .deleteFrom('app_role_tables')
      .where('role_id', '=', roleId)
      .execute();
    for (const t of tableNames) {
      await this.appDb.db
        .insertInto('app_role_tables')
        .values({ role_id: roleId, table_name: t })
        .execute();
    }
    return { ok: true as const };
  }

  async listUsers() {
    return this.appDb.db
      .selectFrom('app_users as u')
      .innerJoin('app_roles as r', 'r.id', 'u.role_id')
      .select([
        'u.id',
        'u.email',
        'u.active',
        'u.role_id as roleId',
        'u.created_at as createdAt',
        'r.slug as roleSlug',
        'r.name as roleName',
      ])
      .orderBy('u.email', 'asc')
      .execute();
  }

  private async getUserRowById(id: string) {
    return this.appDb.db
      .selectFrom('app_users')
      .select(['id', 'email', 'role_id as roleId', 'active', 'password_hash as passwordHash'])
      .where('id', '=', id)
      .executeTakeFirst() as Promise<
      | {
          id: string;
          email: string;
          roleId: string;
          active: boolean;
          passwordHash: string;
        }
      | undefined
    >;
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
    if (!row) throw new NotFoundException('Utilisateur introuvable');

    if (patches.roleId) {
      const roleCheck = await this.appDb.db
        .selectFrom('app_roles')
        .select('id')
        .where('id', '=', patches.roleId)
        .executeTakeFirst();
      if (!roleCheck) throw new BadRequestException('Rôle introuvable');
    }

    const newRoleId = patches.roleId ?? row.roleId;
    const newActive = patches.active !== undefined ? patches.active : row.active;
    const newHash = patches.password
      ? await bcrypt.hash(patches.password, BCRYPT_ROUNDS)
      : row.passwordHash;

    await this.appDb.db
      .updateTable('app_users')
      .set({
        role_id: newRoleId,
        active: newActive,
        password_hash: newHash,
      })
      .where('id', '=', userId)
      .execute();

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

  async getAvailableBiTables(): Promise<{ tables: string[] }> {
    try {
      const tables = await this.schema.getAvailableTableNames();
      return { tables };
    } catch (e) {
      throw new BadRequestException(
        `Impossible de récupérer les tables : ${(e as Error).message}`,
      );
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
    const row = await this.appDb.db
      .selectFrom('bi_llm_settings')
      .select([
        'provider',
        'model',
        sql<boolean>`api_key IS NOT NULL AND length(trim(api_key)) > 0`.as('hasApiKey'),
      ])
      .where('id', '=', true)
      .executeTakeFirst();

    if (!row) {
      return { provider: 'gemini', model: 'gemini-2.5-flash', hasApiKey: false };
    }
    return {
      provider: row.provider as 'gemini' | 'gpt' | 'claude',
      model: String(row.model),
      hasApiKey: Boolean(row.hasApiKey),
    };
  }

  async setLlmSettings(input: {
    provider: 'gemini' | 'gpt' | 'claude';
    model: string;
    apiKey?: string;
  }): Promise<{ ok: true }> {
    await this.ensureLlmSettingsTable();
    const model = String(input.model || '').trim();
    if (!model) throw new BadRequestException('Le modèle est obligatoire.');

    const hasApiKeyField = Object.prototype.hasOwnProperty.call(input, 'apiKey');

    if (hasApiKeyField) {
      const apiKey = (input.apiKey ?? '').trim() || null;
      await this.appDb.db
        .insertInto('bi_llm_settings')
        .values({
          id: true,
          provider: input.provider,
          model,
          api_key: apiKey,
          updated_at: sql`now()`,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            provider: input.provider,
            model,
            api_key: apiKey,
            updated_at: sql`now()`,
          }),
        )
        .execute();
    } else {
      await this.appDb.db
        .insertInto('bi_llm_settings')
        .values({
          id: true,
          provider: input.provider,
          model,
          updated_at: sql`now()`,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            provider: input.provider,
            model,
            updated_at: sql`now()`,
          }),
        )
        .execute();
    }
    return { ok: true as const };
  }

  private async ensureLlmSettingsTable(): Promise<void> {
    await this.appDb.executeDdl(`
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
