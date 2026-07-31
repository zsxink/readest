// Empty module stub for excluding optional dependencies.
//
// The web build aliases `tauri-plugin-turso` and `@tursodatabase/database-wasm`
// here (see next.config.mjs) because those packages only exist in the Tauri
// runtime. `nativeDatabaseService.ts` still imports this module statically, so
// the stub must carry the same types that code references. No instance of these
// is ever constructed on web — the class never gets instantiated there — so the
// types are structural stand-ins only.
export type LoadOptions = Record<string, unknown>;
export type QueryResult = {
  rows: unknown[];
  rowsAffected: number;
  lastInsertRowid?: number | bigint | null;
};

export class Database {
  static async load(_pathOrOptions: string | LoadOptions): Promise<Database> {
    throw new Error('NativeDatabaseService is not available on web');
  }

  async execute(_sql: string, _params?: unknown[]): Promise<QueryResult> {
    throw new Error('NativeDatabaseService is not available on web');
  }
}

export {};
