// update-documento-inscritos.js
// Uso:
//   node update-documento-inscritos.js
//   node update-documento-inscritos.js ./meu-arquivo.json
//   node update-documento-inscritos.js ./meu-arquivo.json --dry-run

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

let dotenvModule;
try {
  dotenvModule = require('dotenv');
} catch (err) {
  // dotenv e opcional
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

const DEFAULT_INPUT = path.join(__dirname, 'documentos-inscritos.json');
const ORDER_CODE_REGEX = /^REG-\d{8}-[A-Z0-9]+$/i;

function formatarCpf(doc) {
  const digitos = String(doc).replace(/\D/g, '');
  if (digitos.length !== 11) return null;
  return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function normalizarOrderCode(value) {
  if (value === undefined || value === null) return null;
  const orderCode = String(value).trim().toUpperCase();
  if (!ORDER_CODE_REGEX.test(orderCode)) return null;
  return orderCode;
}

function normalizarDocumento(value) {
  if (value === undefined || value === null) return null;
  const texto = String(value).trim();
  if (!texto) return null;
  return formatarCpf(texto);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArg = args.find((arg) => !arg.startsWith('--'));
  const inputPath = fileArg ? path.resolve(process.cwd(), fileArg) : DEFAULT_INPUT;
  return { dryRun, inputPath };
}

function carregarJson(filePath) {
  let parsed;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Erro ao ler/parsear JSON (${filePath}): ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('O JSON deve ser um array de objetos.');
  }

  return parsed;
}

async function validarColunaDocumento(client) {
  const result = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = ANY(current_schemas(false))
        AND table_name = 'inscritos'
        AND column_name = 'documento'
      LIMIT 1
    `
  );

  if (result.rowCount === 0) {
    throw new Error('A coluna "documento" nao existe na tabela "inscritos".');
  }
}

async function atualizarDocumentos() {
  const { dryRun, inputPath } = parseArgs(process.argv);
  const dados = carregarJson(inputPath);

  const client = await pool.connect();

  try {
    await validarColunaDocumento(client);

    if (!dryRun) {
      await client.query('BEGIN');
    }

    let processados = 0;
    let pulados = 0;
    let semCorrespondencia = 0;
    let orderCodesAtualizados = 0;
    let linhasAtualizadas = 0;

    for (const item of dados) {
      const orderCode = normalizarOrderCode(
        item.orderCode || item.order_code || item.ordemCode || item.ordem_code
      );
      const documento = normalizarDocumento(item.documento);

      if (!orderCode) {
        console.warn(
          `Pulado: orderCode invalido -> [${item.orderCode || item.order_code || item.ordemCode || item.ordem_code}]`
        );
        pulados++;
        continue;
      }

      if (!documento) {
        console.warn(`Pulado: documento invalido para ${orderCode} -> [${item.documento}]`);
        pulados++;
        continue;
      }

      processados++;

      if (dryRun) {
        const preview = await client.query(
          'SELECT COUNT(*)::int AS total FROM inscritos WHERE order_code = $1',
          [orderCode]
        );

        const total = preview.rows[0]?.total || 0;
        if (total === 0) {
          semCorrespondencia++;
          console.log(`[DRY-RUN] ${orderCode}: nenhum inscrito encontrado`);
          continue;
        }

        orderCodesAtualizados++;
        linhasAtualizadas += total;
        console.log(`[DRY-RUN] ${orderCode}: ${total} registro(s) receberiam documento ${documento}`);
        continue;
      }

      const update = await client.query(
        `
          UPDATE inscritos
          SET documento = $1,
              updated_at = NOW()
          WHERE order_code = $2
        `,
        [documento, orderCode]
      );

      if (update.rowCount === 0) {
        semCorrespondencia++;
        console.log(`${orderCode}: nenhum inscrito encontrado`);
        continue;
      }

      orderCodesAtualizados++;
      linhasAtualizadas += update.rowCount;
      console.log(`${orderCode}: ${update.rowCount} registro(s) atualizado(s)`);
    }

    if (!dryRun) {
      await client.query('COMMIT');
    }

    console.log('\nResumo:');
    console.log(`- Arquivo: ${inputPath}`);
    console.log(`- Dry-run: ${dryRun ? 'sim' : 'nao'}`);
    console.log(`- Itens validos processados: ${processados}`);
    console.log(`- Itens pulados: ${pulados}`);
    console.log(`- orderCode sem correspondencia: ${semCorrespondencia}`);
    console.log(`- orderCode atualizados: ${orderCodesAtualizados}`);
    console.log(`- Linhas atualizadas na tabela: ${linhasAtualizadas}`);
  } catch (err) {
    if (!dryRun) {
      await client.query('ROLLBACK');
    }
    console.error(`Erro: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

atualizarDocumentos().catch((err) => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
