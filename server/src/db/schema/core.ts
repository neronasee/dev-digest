import { pgTable, uuid, text, jsonb, unique, primaryKey } from 'drizzle-orm/pg-core';
import { now } from './_shared';

// ============================================================ Tenancy & core

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: now(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: now(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.userId] }) }),
);

/** Non-secret prefs/config. Secrets go via SecretsProvider, NOT here. */
export const settings = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value'),
  },
  (t) => ({
    // UNIQUE as a table constraint with NULLS NOT DISTINCT: user_id is
    // nullable (workspace-level settings), and Postgres treats NULLs as
    // distinct under a plain unique INDEX — so onConflictDoUpdate never fired
    // for workspace-level rows. NULLS NOT DISTINCT makes (ws, NULL, key)
    // collide like any other duplicate. (Constraint, not uniqueIndex:
    // drizzle-orm/drizzle-kit only support nullsNotDistinct on constraints.)
    uq: unique('settings_ws_user_key_uq').on(t.workspaceId, t.userId, t.key).nullsNotDistinct(),
  }),
);
