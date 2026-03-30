// import-json-inscritos.js
// Uso: node import-json-inscritos.js

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// dotenv é opcional; se não estiver instalado, usamos env vars do sistema
let dotenvModule;
try {
  dotenvModule = require('dotenv');
} catch (e) {
  // não instalado, prossegue
}

if (dotenvModule) {
  dotenvModule.config();
  const serverEnvPath = path.join(__dirname, 'server', '.env');
  if (fs.existsSync(serverEnvPath)) {
    dotenvModule.config({ path: serverEnvPath });
  }
}

const pool = new Pool({
  user: process.env.PG_USER || process.env.PGUSER || 'seu_usuario',
  host: process.env.PG_HOST || process.env.PGHOST || '127.0.0.1',
  database: process.env.PG_DATABASE || process.env.PGDATABASE || 'seu_banco',
  password: process.env.PG_PASSWORD || process.env.PGPASSWORD || 'sua_senha',
  port: Number(process.env.PG_PORT || process.env.PGPORT || 5432),
});

const INPUT_JSON = path.join(__dirname, 'inscritos.json');

const orderCodeRegex = /^REG-\d{8}-[A-Z0-9]+$/i;
const telefoneRegex = /\d+/g;

function normalizaTexto(valor) {
  if (valor === undefined || valor === null) return null;
  return String(valor).trim();
}

function normalizaTelefone(valor) {
  if (valor === undefined || valor === null) return null;
  const digitos = String(valor).match(telefoneRegex);
  if (!digitos) return null;
  return digitos.join('');
}

function normalizaData(valor) {
  if (valor === undefined || valor === null) return null;
  const d = String(valor).trim();
  if (!d) return null;
  return d;
}

async function garantirConflitoPorOrderCodeENome(client) {
  // Remove constraint UNIQUE(order_code), se existir, para permitir mesmo order_code com nomes diferentes.
  const uniqueOrderCodeConstraints = await client.query(
    `
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE c.contype = 'u'
        AND t.relname = 'inscritos'
        AND n.nspname = ANY(current_schemas(false))
      GROUP BY c.conname, c.conkey
      HAVING COUNT(*) = 1 AND MAX(a.attname) = 'order_code'
    `
  );

  for (const row of uniqueOrderCodeConstraints.rows) {
    const constraintName = row.conname.replace(/"/g, '""');
    await client.query(`ALTER TABLE inscritos DROP CONSTRAINT IF EXISTS "${constraintName}"`);
    console.log(`Constraint removida: ${row.conname}`);
  }

  // Remove índices únicos soltos em order_code (não vinculados a constraint), se existirem.
  const uniqueOrderCodeIndexes = await client.query(
    `
      SELECT idx.relname AS index_name
      FROM pg_class tbl
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      JOIN pg_index i ON i.indrelid = tbl.oid
      JOIN pg_class idx ON idx.oid = i.indexrelid
      LEFT JOIN pg_constraint c ON c.conindid = idx.oid
      WHERE tbl.relname = 'inscritos'
        AND ns.nspname = ANY(current_schemas(false))
        AND i.indisunique
        AND c.oid IS NULL
        AND i.indnatts = 1
        AND (i.indkey::smallint[])[1] = (
          SELECT attnum
          FROM pg_attribute
          WHERE attrelid = tbl.oid
            AND attname = 'order_code'
            AND NOT attisdropped
        )
    `
  );

  for (const row of uniqueOrderCodeIndexes.rows) {
    const indexName = row.index_name.replace(/"/g, '""');
    await client.query(`DROP INDEX IF EXISTS "${indexName}"`);
    console.log(`Índice único removido: ${row.index_name}`);
  }

  await client.query(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS inscritos_order_code_nome_completo_uq
      ON inscritos (order_code, nome_completo)
    `
  );
}

async function importar() {
  let dados;
  try {
    let raw = fs.readFileSync(INPUT_JSON, 'utf8');

    // Permite idade escrita com zero à esquerda (09 -> 9), evita erro JSON parse.
    // Também elimina vírgula extra antes de fechar objeto se houver.
    raw = raw.replace(/"idade"\s*:\s*0+(\d+)/g, '"idade": $1');

    // Alguns arquivos podem ter vírgula antes de fechar array/objeto (não-estrito). Ajuste básico.
    raw = raw.replace(/,\s*([}\]])/g, '$1');

    dados = JSON.parse(raw);
    if (!Array.isArray(dados)) throw new Error('inscritos.json deve ser um array');
  } catch (err) {
    console.error('Erro ao ler/parsear inscritos.json:', err.message);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await garantirConflitoPorOrderCodeENome(client);

    let total = 0;
    let pulados = 0;

    for (const item of dados) {
      const order_code = normalizaTexto(item.orderCode || item.order_code);
      const telefone_responsavel = normalizaTelefone(item.telefone_responsavel);
      const nome_completo = normalizaTexto(item.nomeCompleto || item.nome_completo);
      const nome_responsavel = normalizaTexto(item.nome_responsavel);
      const data_de_nascimento = normalizaData(item.data_de_nascimento);
      const endereco = normalizaTexto(item.endereco);
      const idade = Number.isFinite(Number(item.idade)) ? Number(item.idade) : null;
      const lider_de_celula = normalizaTexto(item.lider_de_celula);
      const sexo = normalizaTexto(item.sexo);

      if (!order_code || !orderCodeRegex.test(order_code)) {
        console.warn(`Pulado: order_code inválido -> [${order_code}]`);
        pulados++;
        continue;
      }

      if (!telefone_responsavel) {
        console.warn(`Pulado: telefone_responsavel inválido para order_code ${order_code}`);
        pulados++;
        continue;
      }

      if (!nome_completo) {
        console.warn(`Pulado: nome_completo inválido para order_code ${order_code}`);
        pulados++;
        continue;
      }

      await client.query(
        `INSERT INTO inscritos (
           order_code,
           nome_completo,
           nome_responsavel,
           telefone_responsavel,
           data_de_nascimento,
           endereco,
           idade,
           lider_de_celula,
           sexo,
           created_at,
           updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
         ON CONFLICT (order_code, nome_completo) DO UPDATE SET
           nome_responsavel = EXCLUDED.nome_responsavel,
           telefone_responsavel = EXCLUDED.telefone_responsavel,
           data_de_nascimento = EXCLUDED.data_de_nascimento,
           endereco = EXCLUDED.endereco,
           idade = EXCLUDED.idade,
           lider_de_celula = EXCLUDED.lider_de_celula,
           sexo = EXCLUDED.sexo,
           updated_at = NOW()`,
        [
          order_code,
          nome_completo,
          nome_responsavel,
          telefone_responsavel,
          data_de_nascimento,
          endereco,
          idade,
          lider_de_celula,
          sexo,
        ]
      );

      total++;
      if (total % 50 === 0) console.log(`Processados ${total}`);
    }

    await client.query('COMMIT');
    console.log(`Importação concluída: ${total} inseridos/atualizados, ${pulados} pulados`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Rollback aplicado por erro:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

importar().catch((err) => {
  console.error('Erro inesperado na importação:', err);
  process.exit(1);
});
