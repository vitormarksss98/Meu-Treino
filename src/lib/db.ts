import { SQLiteDatabase } from "expo-sqlite";

const VERSAO_ATUAL = 2;

export async function migrarBanco(db: SQLiteDatabase) {
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  const r = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const versao = r?.user_version ?? 0;
  if (versao >= VERSAO_ATUAL) return;

  await db.withTransactionAsync(async () => {
    if (versao < 1) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS exercicios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
          grupo TEXT
        );
        CREATE TABLE IF NOT EXISTS treinos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS treino_exercicios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          treino_id INTEGER NOT NULL REFERENCES treinos(id) ON DELETE CASCADE,
          exercicio_id INTEGER NOT NULL REFERENCES exercicios(id),
          series_planejadas INTEGER NOT NULL DEFAULT 3,
          ordem INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          treino_id INTEGER REFERENCES treinos(id) ON DELETE SET NULL,
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS series (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sessao_id INTEGER NOT NULL REFERENCES sessoes(id) ON DELETE CASCADE,
          exercicio_id INTEGER NOT NULL REFERENCES exercicios(id),
          carga REAL NOT NULL,
          reps INTEGER NOT NULL,
          aquecimento INTEGER NOT NULL DEFAULT 0,
          obs TEXT
        );
        CREATE TABLE IF NOT EXISTS rascunhos (
          treino_id INTEGER PRIMARY KEY,
          dados TEXT NOT NULL,
          atualizado TEXT NOT NULL
        );
      `);
    }

    if (versao < 2) {
      await db.execAsync(`
        ALTER TABLE series ADD COLUMN tipo TEXT NOT NULL DEFAULT 'normal';
        UPDATE series SET tipo = 'aq' WHERE aquecimento = 1;
        ALTER TABLE exercicios ADD COLUMN nota TEXT;
      `);
    }

    await db.execAsync(`PRAGMA user_version = ${VERSAO_ATUAL}`);
  });
}