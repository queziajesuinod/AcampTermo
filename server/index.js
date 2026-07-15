// Backend PDF CORRIGIDO - Formatação e layout do PDF corrigidos
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const dayjs = require('dayjs');
require('dotenv').config();

const app = express();
const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const host = (process.env.HOST || `http://localhost:${port}`).replace(/\/$/, '');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/assinados', express.static(path.join(__dirname, 'public', 'assinados')));

// Configuração do banco PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

// 🔧 Função melhorada para quebrar texto
function quebrarTexto(texto, font, tamanho, larguraMaxima) {
  const palavras = texto.split(' ');
  const linhas = [];
  let linhaAtual = '';

  for (const palavra of palavras) {
    const teste = linhaAtual ? linhaAtual + ' ' + palavra : palavra;
    const larguraTeste = font.widthOfTextAtSize(teste, tamanho);

    if (larguraTeste <= larguraMaxima) {
      linhaAtual = teste;
    } else {
      if (linhaAtual) {
        linhas.push(linhaAtual);
        linhaAtual = palavra;
      } else {
        linhas.push(palavra);
      }
    }
  }

  if (linhaAtual) {
    linhas.push(linhaAtual);
  }

  return linhas;
}

// Funcao para desenhar texto justificado
function desenharTextoJustificado(
  page,
  texto,
  x,
  y,
  tamanho,
  font,
  larguraMaxima,
  espacoEntreLinhas = 16,
  justificar = true
) {
  const linhas = quebrarTexto(texto, font, tamanho, larguraMaxima);
  let yAtual = y;

  linhas.forEach((linha, index) => {
    const ehUltimaLinha = index === linhas.length - 1;

    if (!justificar || ehUltimaLinha || linha.split(' ').length === 1) {
      page.drawText(linha, {
        x,
        y: yAtual,
        size: tamanho,
        font,
        color: rgb(0, 0, 0),
      });
    } else {
      const palavras = linha.split(' ');
      const larguraSemEspacos = palavras.reduce((total, palavra) => {
        return total + font.widthOfTextAtSize(palavra, tamanho);
      }, 0);

      const espacoTotal = larguraMaxima - larguraSemEspacos;
      const espacoEntrePalavras = espacoTotal / (palavras.length - 1);

      let xAtual = x;
      palavras.forEach((palavra, i) => {
        page.drawText(palavra, {
          x: xAtual,
          y: yAtual,
          size: tamanho,
          font,
          color: rgb(0, 0, 0),
        });

        if (i < palavras.length - 1) {
          xAtual += font.widthOfTextAtSize(palavra, tamanho) + espacoEntrePalavras;
        }
      });
    }

    yAtual -= espacoEntreLinhas;
  });

  return yAtual;
}

// Formata/valida CPF: retorna '000.000.000-00' ou null se nao tiver 11 digitos
function formatarCpf(valor) {
  if (valor === undefined || valor === null) return null;
  const digitos = String(valor).replace(/\D/g, '');
  if (digitos.length !== 11) return null;
  return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

// Funcao para processar campos dinamicos
function processarCampos(texto, dados) {
  let textoProcessado = texto;

  Object.keys(dados).forEach((campo) => {
    const regex = new RegExp('{' + campo + '}', 'g');
    textoProcessado = textoProcessado.replace(regex, dados[campo]);
  });

  return textoProcessado;
}

function paragrafoDeveNegrito(paragrafo) {
  const texto = String(paragrafo || '').trim();
  if (!texto) return false;
  if (/^\d+\.\s/.test(texto)) return true;

  return (
    texto === 'Estou ciente de que:' ||
    texto === 'A organização compromete-se a:' ||
    texto === 'Declaro que:'
  );
}

function tipoListaPorCabecalho(texto) {
  if (texto === 'Estou ciente de que:') return 'conduta';
  if (texto === 'A organização compromete-se a:') return 'protecao';
  if (texto === 'Estou ciente de que, em caso de:') return 'medidas';
  if (texto === 'Declaro que:') return 'declaracao';
  return null;
}

function ehItemDeLista(texto, tipoListaAtual) {
  if (!tipoListaAtual) return false;

  if (tipoListaAtual === 'conduta') {
    return !/^\d+\.\s/.test(texto) && texto !== 'Estou ciente de que:';
  }

  if (tipoListaAtual === 'protecao') {
    return (
      !/^\d+\.\s/.test(texto) &&
      texto !== 'A organização compromete-se a:' &&
      !texto.startsWith('Da mesma forma')
    );
  }

  if (tipoListaAtual === 'medidas' || tipoListaAtual === 'declaracao') {
    return /;$/.test(texto);
  }

  return false;
}

function resolveInscritoSelector(payload) {
  const { inscrito_id, order_code, telefone_responsavel } = payload;

  if (inscrito_id !== undefined && inscrito_id !== null && String(inscrito_id).trim() !== '') {
    const parsedId = Number(inscrito_id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return { error: 'inscrito_id invalido' };
    }
    return { keyField: 'id', keyValue: parsedId };
  }

  if (order_code) {
    return { keyField: 'order_code', keyValue: order_code };
  }

  if (telefone_responsavel) {
    return { keyField: 'telefone_responsavel', keyValue: telefone_responsavel };
  }

  return null;
}

function nomeArquivoSeguro(baseName, inscritoId) {
  const sanitizedBaseName = String(baseName || 'inscrito').replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitizedBaseName + '-' + String(inscritoId) + '.pdf';
}

async function carregarImagemBaseTermo(pdfDoc) {
  const caminhoBaseTermo = path.join(__dirname, 'public', 'basetermo.jpg');

  try {
    const imagemBytes = await fs.readFile(caminhoBaseTermo);
    return await pdfDoc.embedJpg(imagemBytes);
  } catch (error) {
    console.warn('Não foi possível carregar basetermo.jpg. O PDF será gerado sem fundo.', error.message);
    return null;
  }
}

function aplicarFundoPagina(page, imagemFundo) {
  if (!imagemFundo) return;

  const { width, height } = page.getSize();
  page.drawImage(imagemFundo, {
    x: 0,
    y: 0,
    width,
    height,
    opacity: 1,
  });
}

// Endpoint para buscar inscrito por order_code ou telefone_responsavel
app.get('/api/inscrito', async (req, res) => {
  try {
    const { order_code, telefone_responsavel } = req.query;

    if (!order_code && !telefone_responsavel) {
      return res.status(400).json({
        success: false,
        message: 'Informe order_code ou telefone do responsável na consulta'
      });
    }

    const searchCriteria = order_code ? 'order_code ' + order_code : 'telefone_responsavel ' + telefone_responsavel;
    console.log('Buscando inscrito por ' + searchCriteria);

    let query = 'SELECT * FROM inscritos WHERE';
    const params = [];

    if (order_code) {
      params.push(order_code);
      query += ' order_code = $' + params.length;
    }

    if (telefone_responsavel) {
      if (params.length > 0) {
        query += ' OR';
      }
      params.push(telefone_responsavel);
      query += ' telefone_responsavel = $' + params.length;
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      console.log('Inscrito não encontrado para ' + searchCriteria);
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
      });
    }

    if (result.rows.length > 1) {
      console.log('Múltiplos inscritos encontrados para ' + searchCriteria + ': ' + result.rows.length);
      return res.json({
        success: true,
        multiple: true,
        data: result.rows,
        message: result.rows.length + ' inscritos encontrados. Selecione um para continuar.'
      });
    }

    const inscrito = result.rows[0];

    const foiAssinado = inscrito.assinatura_realizada === true || inscrito.assinatura_realizada === 't';
    const temPDF = inscrito.pdf_path && inscrito.pdf_path.trim() !== '';

    if (foiAssinado && temPDF) {
      return res.json({
        success: true,
        data: inscrito,
        ja_assinado: true,
        pdf_url: inscrito.pdf_path,
        message: 'Este inscrito ja possui termo de responsabilidade assinado'
      });
    }

    return res.json({
      success: true,
      data: inscrito,
      ja_assinado: false
    });
  } catch (error) {
    console.error('Erro ao buscar inscrito:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para atualizar dados do inscrito por order_code
app.put('/api/inscrito/:order_code', async (req, res) => {
  try {
    const { order_code } = req.params;
    const {
      nome_completo,
      lote,
      nome_responsavel,
      telefone_responsavel,
      tel_responsavel,
      data_de_nascimento,
      endereco,
      idade,
      lider_de_celula,
      sexo,
      contato_nome,
      contato_telefone
    } = req.body;

    const nomeResp = nome_responsavel;
    const telefoneResp = telefone_responsavel || tel_responsavel;

    const updateQuery =
      'UPDATE inscritos SET ' +
      'nome_completo = $1, lote = $2, nome_responsavel = $3, telefone_responsavel = $4, ' +
      'data_de_nascimento = $5, endereco = $6, idade = $7, lider_de_celula = $8, sexo = $9, ' +
      'contato_nome = $10, contato_telefone = $11 ' +
      'WHERE order_code = $12 RETURNING *';

    const result = await pool.query(updateQuery, [
      nome_completo,
      lote,
      nomeResp,
      telefoneResp,
      data_de_nascimento,
      endereco,
      idade,
      lider_de_celula,
      sexo,
      contato_nome,
      contato_telefone,
      order_code
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
      });
    }

    return res.json({
      success: true,
      data: result.rows[0],
      message: 'Dados atualizados com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar dados:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para gerar PDF
app.post('/api/gerar-pdf', async (req, res) => {
  try {
    const { inscrito_id, order_code, telefone_responsavel, contato_nome, contato_telefone, documento, dados_editados } = req.body;
    const selector = resolveInscritoSelector({ inscrito_id, order_code, telefone_responsavel });

    // CPF obrigatorio para gravar na coluna documento
    const documentoFormatado = formatarCpf(documento);
    if (!documentoFormatado) {
      return res.status(400).json({
        success: false,
        message: 'CPF é obrigatório e deve conter 11 dígitos para gerar o termo'
      });
    }

    if (!selector) {
      return res.status(400).json({
        success: false,
        message: 'inscrito_id ou order_code ou telefone_responsavel é obrigatório para gerar o PDF'
      });
    }

    if (selector.error) {
      return res.status(400).json({
        success: false,
        message: selector.error
      });
    }

    const { keyField, keyValue } = selector;
    const result = await pool.query('SELECT * FROM inscritos WHERE ' + keyField + ' = $1', [keyValue]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
      });
    }

    if (result.rows.length > 1 && keyField !== 'id') {
      return res.status(400).json({
        success: false,
        message: 'Mais de um inscrito encontrado. Informe inscrito_id para gerar o PDF correto.'
      });
    }

    let inscrito = result.rows[0];
    const inscritoId = inscrito.id;

    if (dados_editados) {
      inscrito = { ...inscrito, ...dados_editados };
    }

    // Garante que o CPF informado seja usado no termo
    inscrito.documento = documentoFormatado;

    await pool.query(
      'UPDATE inscritos SET contato_nome = $1, contato_telefone = $2, documento = $3 WHERE id = $4',
      [contato_nome, contato_telefone, documentoFormatado, inscritoId]
    );

    if (dados_editados) {
      await pool.query(
        'UPDATE inscritos SET nome_completo = $1, nome_responsavel = $2, telefone_responsavel = $3 WHERE id = $4',
        [
          dados_editados.nome_completo,
          dados_editados.nome_responsavel || dados_editados.responsavel,
          dados_editados.telefone_responsavel || dados_editados.tel_responsavel,
          inscritoId
        ]
      );
    }

    const dados = {
      NOME_FILHO: inscrito.nome_completo || 'NÃO INFORMADO',
      NOME_RESPONSAVEL: inscrito.nome_responsavel || inscrito.responsavel || 'NÃO INFORMADO',
      CONTATO_NOME: contato_nome || 'NÃO INFORMADO',
      DOCUMENTO: inscrito.documento || 'NÃO INFORMADO',
      CONTATO_TELEFONE: contato_telefone || 'NÃO INFORMADO'
    };

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 50;
    const recuoTopoConteudo = 90;
    const textWidth = pageWidth - (margin * 2);
    const fontSize = 11;
    const titleFontSize = 16;
    const subtitleFontSize = 14;
    const imagemFundo = await carregarImagemBaseTermo(pdfDoc);

    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    aplicarFundoPagina(page1, imagemFundo);
    let yPosition = pageHeight - margin - recuoTopoConteudo;

    const titulo = 'TERMO DE RESPONSABILIDADE, AUTORIZA\u00C7\u00C3O E CI\u00CANCIA DAS NORMAS';
    const titleHorizontalMargin = margin + 24;
    const titleMaxWidth = pageWidth - (titleHorizontalMargin * 2);
    const titleLines = quebrarTexto(titulo, fontBold, titleFontSize, titleMaxWidth);
    const titleLineHeight = titleFontSize + 4;

    titleLines.forEach((line, index) => {
      const lineWidth = fontBold.widthOfTextAtSize(line, titleFontSize);
      page1.drawText(line, {
        x: (pageWidth - lineWidth) / 2,
        y: yPosition - (index * titleLineHeight),
        size: titleFontSize,
        font: fontBold,
        color: rgb(0, 0, 0),
      });
    });

    yPosition -= (titleLines.length * titleLineHeight) + 12;

    const subtitulo = 'ACAMP RELEVANTE JUNIORS 2026';
    const subtituloWidth = font.widthOfTextAtSize(subtitulo, subtitleFontSize);
    page1.drawText(subtitulo, {
      x: (pageWidth - subtituloWidth) / 2,
      y: yPosition,
      size: subtitleFontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    yPosition -= 50;

    const paragrafos_teen = [
      'Eu, {NOME_RESPONSAVEL}, CPF n\u00BA {DOCUMENTO}, respons\u00E1vel legal pelo(a) pr\u00E9-adolescente {NOME_FILHO}, doravante denominado(a) ACAMPANTE, declaro para os devidos fins que:',
      '1. AUTORIZA\u00C7\u00C3O DE PARTICIPA\u00C7\u00C3O',
      'Autorizo o(a) ACAMPANTE a participar de todas as atividades, ministra\u00E7\u00F5es, programa\u00E7\u00F5es recreativas, esportivas, espirituais e demais din\u00E2micas realizadas no ACAMP RELEVANTEEN 2026, promovido pela Igreja Evang\u00E9lica Comunidade Global.',
      'Declaro estar ciente de que o evento possui programa\u00E7\u00E3o organizada, normas internas e acompanhamento por equipe de l\u00EDderes, volunt\u00E1rios e coordena\u00E7\u00E3o.',
      '2. AUTORIZA\u00C7\u00C3O PARA ATENDIMENTO M\u00C9DICO',
      'Autorizo, em caso de acidente, mal-estar ou necessidade m\u00E9dica, que a coordena\u00E7\u00E3o do evento encaminhe o(a) ACAMPANTE para atendimento em hospital, pronto socorro ou unidade de sa\u00FAde de Campo Grande/MS, podendo inclusive autorizar procedimentos emergenciais necess\u00E1rios \u00E0 preserva\u00E7\u00E3o da vida e da sa\u00FAde.',
      'Comprometo-me a fornecer todas as informa\u00E7\u00F5es m\u00E9dicas relevantes (alergias, uso de medicamentos, restri\u00E7\u00F5es alimentares, condi\u00E7\u00F5es pr\u00E9-existentes).',
      '3. AUTORIZA\u00C7\u00C3O DE USO DE IMAGEM',
      'Autorizo, de forma gratuita e por prazo indeterminado, o uso da imagem do(a) ACAMPANTE registrada em fotografias ou v\u00EDdeos produzidos no contexto do evento, exclusivamente para divulga\u00E7\u00E3o institucional, sem finalidade comercial, nas redes sociais, site oficial e demais meios de comunica\u00E7\u00E3o da Igreja Evang\u00E9lica Comunidade Global e do ACAMP RELEVANTEEN.',
      '4. RESPONSABILIDADE POR OBJETOS PESSOAIS',
      'Declaro estar ciente de que a organiza\u00E7\u00E3o n\u00E3o se responsabiliza por extravio, perda ou dano de objetos pessoais de valor (celulares, c\u00E2meras, rel\u00F3gios, joias, entre outros), sendo de inteira responsabilidade do(a) ACAMPANTE e de seus respons\u00E1veis.',
      '5. RESPONSABILIDADE POR DANOS AO PATRIM\u00D4NIO',
      'Comprometo-me a ressarcir integralmente eventuais danos materiais causados pelo(a) ACAMPANTE ao patrim\u00F4nio do local do evento (CTOC) ou a terceiros, desde que comprovada sua responsabilidade.',
      '6. CI\u00CANCIA DAS NORMAS DE CONDUTA E SEGURAN\u00C7A',
      'Declaro estar ciente de que o ACAMP RELEVANTEEN adota Pol\u00EDtica de Seguran\u00E7a Infantil e C\u00F3digo de Estilo de Vida em Comunidade, com base na legisla\u00E7\u00E3o brasileira, especialmente no Estatuto da Crian\u00E7a e do Adolescente.',
      'Estou ciente de que:',
      'N\u00E3o s\u00E3o permitidos comportamentos violentos, ofensivos, discriminat\u00F3rios ou desrespeitosos.',
      '\u00C9 proibido porte ou uso de drogas il\u00EDcitas, \u00E1lcool, tabaco (inclusive cigarro eletr\u00F4nico), armas ou objetos perigosos.',
      'S\u00E3o proibidas pr\u00E1ticas de bullying, intimida\u00E7\u00E3o, amea\u00E7as ou qualquer forma de abuso.',
      'O uso de linguagem ofensiva, preconceituosa ou vulgar n\u00E3o ser\u00E1 tolerado.',
      'O acesso aos dormit\u00F3rios ser\u00E1 restrito conforme divis\u00E3o por sexo.',
      'O cumprimento de horários, regras de vestuário e participação na programação é obrigatório.',
      'É obrigatório o uso de identificação do evento.',
      'É vedada qualquer conduta que coloque em risco a integridade física, emocional, psicológica ou espiritual dos participantes.',
      '7. POL\u00CDTICA DE PROTE\u00C7\u00C3O E SEGURAN\u00C7A DO MENOR',
      'A organização compromete-se a:',
      'Garantir ambiente seguro e supervisionado.',
      'Proteger os pré-adolescentes contra qualquer forma de abuso (físico, emocional, sexual ou espiritual).',
      'Adotar medidas imediatas em caso de suspeita ou ocorrência de violação de direitos.',
      'Comunicar responsáveis e autoridades competentes quando necessário.',
      'Da mesma forma, declaro estar ciente de que qualquer situação grave revelada pelo(a) ACAMPANTE poderá ser encaminhada à Supervisão Pastoral e, quando exigido por lei, às autoridades competentes.',
      '8. MEDIDAS DISCIPLINARES',
      'Estou ciente de que, em caso de:',
      'Mau comportamento;',
      'Desobediência às regras;',
      'Condutas que coloquem em risco outros participantes;',
      'o(a) ACAMPANTE poderá ser desligado(a) do evento, devendo o responsável providenciar sua retirada imediata, sem direito à devolução do valor da inscrição.',
      '9. DECLARAÇÃO FINAL',
      'Declaro que:',
      'Li integralmente este Termo;',
      'Compreendi todas as cláusulas;',
      'Estou de acordo com as normas estabelecidas;',
      'Autorizo a participação do(a) ACAMPANTE conforme as condições aqui descritas.',
      'Por ser expressão da verdade, firmo o presente Termo.'
    ];

    const paragrafos = [
      'Eu, {NOME_RESPONSAVEL}, CPF nº {DOCUMENTO}, responsável legal pelo(a) adolescente {NOME_FILHO}, doravante denominado(a) ACAMPANTE, declaro para os devidos fins que:',
      '1. AUTORIZAÇÃO DE PARTICIPAÇÃO',
      'Autorizo o(a) ACAMPANTE a participar de todas as atividades, ministrações, programações recreativas, esportivas, espirituais e demais dinâmicas realizadas no ACAMP RELEVANTE JUNIORS 2026, promovido pela Igreja Evangélica Comunidade Global.',
      'Declaro estar ciente de que o evento possui programação organizada, normas internas e acompanhamento por equipe de líderes, voluntários e coordenação.',
      '2. AUTORIZAÇÃO PARA ATENDIMENTO MÉDICO',
      'Autorizo, em caso de acidente, mal-estar ou necessidade médica, que a coordenação do evento encaminhe o(a) ACAMPANTE para atendimento em hospital, pronto socorro ou unidade de saúde de Campo Grande/MS, podendo inclusive autorizar medicações e/ou procedimentos emergenciais necessários à preservação da vida e da saúde.',
      'Comprometo-me a fornecer todas as informações médicas relevantes (alergias, uso de medicamentos, restrições alimentares, condições pré-existentes).',
      '3. AUTORIZAÇÃO DE USO DE IMAGEM',
      'Autorizo, de forma gratuita e por prazo indeterminado, o uso da imagem do(a) ACAMPANTE registrada em fotografias ou vídeos produzidos no contexto do evento, exclusivamente para divulgação institucional, sem finalidade comercial, nas redes sociais, site oficial e demais meios de comunicação da Igreja Evangélica Comunidade Global e do ACAMP RELEVANTE JUNIORS.',
      '4. RESPONSABILIDADE POR OBJETOS PESSOAIS',
      'Declaro estar ciente de que a organização não se responsabiliza por extravio, perda ou dano de objetos pessoais de valor (celulares, câmeras, relógios, joias, entre outros), sendo de inteira responsabilidade do(a) ACAMPANTE e de seus responsáveis.',
      '5. RESPONSABILIDADE POR DANOS AO PATRIMÔNIO',
      'Comprometo-me a ressarcir integralmente eventuais danos materiais causados pelo(a) ACAMPANTE ao patrimônio do local do evento (CTOC) ou a terceiros, desde que comprovada sua responsabilidade.',
      '6. CIÊNCIA DAS NORMAS DE CONDUTA E SEGURANÇA',
      'Declaro estar ciente de que o ACAMP RELEVANTE JUNIORS adota Política de Segurança Infantil e Código de Estilo de Vida em Comunidade, com base na legislação brasileira, especialmente no Estatuto da Criança e do Adolescente.',
      'Estou ciente de que:',
      'Não são permitidos comportamentos violentos, ofensivos, discriminatórios ou desrespeitosos.',
      'É proibido porte ou uso de drogas ilícitas, álcool, tabaco (inclusive cigarro eletrônico), armas ou objetos perigosos.',
      'São proibidas práticas de bullying, intimidação, ameaças ou qualquer forma de abuso.',
      'O uso de linguagem ofensiva, preconceituosa ou vulgar não será tolerado.',
      'O acesso aos dormitórios será restrito conforme divisão por sexo.',
      'O cumprimento de horários, regras de vestuário e participação na programação é obrigatório.',
      'É obrigatório o uso de identificação do evento.',
      'É vedada qualquer conduta que coloque em risco a integridade física, emocional, psicológica ou espiritual dos participantes.',
      '7. POLÍTICA DE PROTEÇÃO E SEGURANÇA DO MENOR',
      'A organização compromete-se a:',
      'Garantir ambiente seguro e supervisionado;',
      'Proteger os adolescentes contra qualquer forma de dano a sua integridade física/emocional;',
      'Adotar medidas imediatas em caso de suspeita ou ocorrência de violação de direitos;',
      'Comunicar responsáveis e autoridades competentes quando necessário;',
      'Da mesma forma, declaro estar ciente de que qualquer situação grave revelada pelo(a) ACAMPANTE poderá ser encaminhada a Supervisão Pastoral e, quando exigido por lei, as autoridades competentes.',
      '8. MEDIDAS DISCIPLINARES',
      'Estou ciente de que, em caso de:',
      'Mau comportamento;',
      'Desobediência as regras;',
      'Condutas que coloquem em risco outros participantes;',
      'o(a) ACAMPANTE poderá ser desligado(a) do evento, devendo o responsável providenciar sua retirada imediata, sem direito a devolução do valor da inscrição.',
      '9. DECLARAÇÃO FINAL',
      'Declaro que:',
      'Li integralmente este Termo;',
      'Compreendi todas as cláusulas;',
      'Estou de acordo com as normas estabelecidas;',
      'Autorizo a participação do(a) ACAMPANTE conforme as condições aqui descritas.',
      'Por ser expressão da verdade, firmo o presente Termo.'
    ];

    let paginaAtual = page1;
    let tipoListaAtual = null;

    paragrafos.forEach((paragrafo, index) => {
      const textoOriginal = String(paragrafo || '').trim();

      if (/^\d+\.\s/.test(textoOriginal)) {
        tipoListaAtual = null;
      }

      const novoTipoLista = tipoListaPorCabecalho(textoOriginal);
      if (novoTipoLista) {
        tipoListaAtual = novoTipoLista;
      }

      const usarNegrito = paragrafoDeveNegrito(textoOriginal);
      const fonteParagrafo = usarNegrito ? fontBold : font;
      const espacoEntreLinhas = usarNegrito ? 17 : 16;
      let justificar = !usarNegrito;
      let recuoX = 0;
      let espacoAposParagrafo = 10;

      let textoProcessado = processarCampos(textoOriginal, dados);
      const itemLista = ehItemDeLista(textoOriginal, tipoListaAtual);

      if (itemLista) {
        textoProcessado = '- ' + textoProcessado;
        recuoX = 18;
        justificar = false;
        espacoAposParagrafo = 6;
      }

      yPosition = desenharTextoJustificado(
        paginaAtual,
        textoProcessado,
        margin + recuoX,
        yPosition,
        fontSize,
        fonteParagrafo,
        textWidth - recuoX,
        espacoEntreLinhas,
        justificar
      );
      yPosition -= espacoAposParagrafo;

      if (yPosition < 150 && index < paragrafos.length - 1) {
        const page2 = pdfDoc.addPage([pageWidth, pageHeight]);
        aplicarFundoPagina(page2, imagemFundo);
        yPosition = pageHeight - margin - recuoTopoConteudo;
        paginaAtual = page2;
      }
    });

    const pdfBytes = await pdfDoc.save();

    const diretorioAssinados = path.join(__dirname, 'public', 'assinados');
    try {
      await fs.access(diretorioAssinados);
    } catch {
      await fs.mkdir(diretorioAssinados, { recursive: true });
    }

    const nomeArquivo = nomeArquivoSeguro(inscrito.order_code || inscrito.telefone_responsavel, inscritoId);
    const caminhoCompleto = path.join(diretorioAssinados, nomeArquivo);
    await fs.writeFile(caminhoCompleto, pdfBytes);

    const pdfPath = '/assinados/' + nomeArquivo;
    await pool.query(
      'UPDATE inscritos SET pdf_path = $1, assinatura_realizada = false WHERE id = $2',
      [pdfPath, inscritoId]
    );

    return res.json({
      success: true,
      pdf_url: pdfPath,
      documento: documentoFormatado,
      message: 'PDF gerado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para atualizar assinatura
app.post('/api/atualizar-assinatura', async (req, res) => {
  try {
    const { inscrito_id, order_code, telefone_responsavel, assinatura } = req.body;
    const selector = resolveInscritoSelector({ inscrito_id, order_code, telefone_responsavel });

    if (!selector) {
      return res.status(400).json({
        success: false,
        message: 'inscrito_id ou order_code ou telefone_responsavel é obrigatório para atualizar assinatura'
      });
    }


    if (selector.error) {
      return res.status(400).json({
        success: false,
        message: selector.error
      });
    }

    const { keyField, keyValue } = selector;
    console.log('Atualizando assinatura para ' + keyField + ': ' + keyValue);

    // Buscar dados do inscrito
    const result = await pool.query(`SELECT * FROM inscritos WHERE ${keyField} = $1`, [keyValue]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
      });
    }

    if (result.rows.length > 1 && keyField !== 'id') {
      return res.status(400).json({
        success: false,
        message: 'Mais de um inscrito encontrado. Informe inscrito_id para assinar o termo correto.'
      });
    }

    const inscrito = result.rows[0];

    if (!inscrito.pdf_path) {
      return res.status(400).json({
        success: false,
        message: 'PDF não encontrado. Gere o termo primeiro.'
      });
    }

    // Construir caminho físico correto
    const caminhoFisico = path.join(__dirname, 'public', inscrito.pdf_path.replace('/assinados/', 'assinados/'));

    console.log(`Caminho físico do PDF: ${caminhoFisico}`);

    // Ler PDF existente
    const pdfBytes = await fs.readFile(caminhoFisico);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Obter última página
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { height } = lastPage.getSize();

    // Converter assinatura base64 para PNG
    const assinaturaBase64 = assinatura.replace(/^data:image\/png;base64,/, '');
    const assinaturaBuffer = Buffer.from(assinaturaBase64, 'base64');
    const pngImage = await pdfDoc.embedPng(assinaturaBuffer);

    // Dados para a assinatura
    const dados = {
      nomeResponsavel: inscrito.nome_responsavel || 'NÃO INFORMADO',
      documento: inscrito.documento || 'NÃO INFORMADO',
      data: dayjs().format('DD/MM/YYYY')
    };

    // 🔧 CALCULAR POSIÇÃO DINÂMICA DA ASSINATURA
    // Buscar posição aproximada do último texto na página
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // x POSI!ÒO MAIS PRXIMA DO aLTIMO TEXTO
    // Estimar posição baseada no conteúdo típico do documento
    let yAssinatura;

    if (pages.length === 1) {
      // Se é uma página só, assinatura mais embaixo
      yAssinatura = 130;
    } else {
      // Se são duas páginas, assinatura logo após o último parágrafo da página 2
      yAssinatura = 180;
    }

    console.log(`📍 Posição da assinatura calculada: ${yAssinatura} (altura da página: ${height})`);

    // x ESPA!O ANTES DA ASSINATURA (MENOR)
    // Mantém a assinatura mais baixa para não conflitar com o texto final.

    // Adicionar assinatura digital
    lastPage.drawImage(pngImage, {
      x: 50,
      y: yAssinatura,
      width: 300,
      height: 60,
    });

    // Adicionar texto da assinatura
    lastPage.drawText(`Assinatura do responsável: ${dados.nomeResponsavel}`, {
      x: 50,
      y: yAssinatura - 20,
      size: 11,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    lastPage.drawText(`CPF: ${dados.documento}`, {
      x: 50,
      y: yAssinatura - 40,
      size: 11,
      font: font,
      color: rgb(0, 0, 0),
    });

    const dataLocal = `Campo Grande/MS, ${dados.data}`;

    lastPage.drawText(dataLocal, {
      x: 50,
      y: yAssinatura - 60,
      size: 11,
      font: font,
      color: rgb(0, 0, 0),
    });
    console.log(`✍️ Assinatura adicionada na posição Y: ${yAssinatura}`);

    // Salvar PDF atualizado
    const pdfBytesAtualizados = await pdfDoc.save();
    await fs.writeFile(caminhoFisico, pdfBytesAtualizados);

    // Atualizar status no banco
    await pool.query(
      'UPDATE inscritos SET assinatura_realizada = true WHERE id = $1',
      [inscrito.id]
    );

    console.log(`✅ Assinatura adicionada com sucesso para ${keyField}: ${keyValue}`);

    res.json({
      success: true,
      message: 'Assinatura adicionada com sucesso',
      pdf_url: inscrito.pdf_path
    });

  } catch (error) {
    console.error('❌ Erro ao atualizar assinatura:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// 🆕 ENDPOINT: Listar termos validados (assinados)
app.get('/api/validados', async (req, res) => {
  try {
    console.log('🔍 Buscando termos validados...');

    const { busca, page = 1, limit = 50 } = req.query;

    let query = `
      SELECT 
        id,
        order_code,
        nome_completo,
        nome_responsavel,
        telefone_responsavel,
        data_de_nascimento,
        idade,
        lider_de_celula AS lider_celula,
        assinatura_realizada,
        pdf_path,
        contato_nome,
        contato_telefone
      FROM inscritos 
      WHERE assinatura_realizada = true 
      AND pdf_path IS NOT NULL 
      AND pdf_path != ''
    `;

    const params = [];
    let paramCount = 0;

    // Filtro por busca (nome, order_code ou telefone_responsavel)
    if (busca && busca.trim() !== '') {
      paramCount++;
      query += ` AND (nome_completo ILIKE $${paramCount} OR order_code ILIKE $${paramCount} OR telefone_responsavel ILIKE $${paramCount})`;
      params.push(`%${busca.trim()}%`);
    }

    // (não aplica mais filtro por campus)

    // Ordenação
    query += ` ORDER BY id DESC`;

    // Paginação
    const offset = (page - 1) * limit;
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await pool.query(query, params);

    // Query para contar total de registros
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM inscritos 
      WHERE assinatura_realizada = true 
      AND pdf_path IS NOT NULL 
      AND pdf_path != ''
    `;

    const countParams = [];
    let countParamCount = 0;

    // Aplicar os mesmos filtros na contagem
    if (busca && busca.trim() !== '') {
      countParamCount++;
      countQuery += ` AND (nome_completo ILIKE $${countParamCount} OR order_code ILIKE $${countParamCount} OR telefone_responsavel ILIKE $${countParamCount})`;
      countParams.push(`%${busca.trim()}%`);
    }

    // (não aplica mais filtro por campus)

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    // Processar resultados
    const validados = result.rows.map(inscrito => ({
      ...inscrito,
      pdf_url: inscrito.pdf_path,
      order_code: inscrito.order_code,
      telefone_responsavel: inscrito.telefone_responsavel,
      data_nascimento_formatada: inscrito.data_de_nascimento ?
        new Date(inscrito.data_de_nascimento).toLocaleDateString('pt-BR') : 'N/A'
    }));

    console.log(`Encontrados ${validados.length} termos validados de ${total} no total`);

    res.json({
      success: true,
      data: validados,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / limit)
      },
      filters: {
        busca
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar termos validados:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor ao buscar termos validados',
      error: error.message
    });
  }
});

// 🆕 ENDPOINT: Estatísticas dos validados
app.get('/api/validados/stats', async (req, res) => {
  try {
    console.log('📊 Buscando estatísticas dos validados...');

    const statsQuery = `
      SELECT 
        COUNT(*) as total_assinados
      FROM inscritos 
      WHERE assinatura_realizada = true 
      AND pdf_path IS NOT NULL 
      AND pdf_path != ''
    `;

    const result = await pool.query(statsQuery);

    // Separar estatísticas gerais e por campus
    const totalAssinados = parseInt(result.rows[0]?.total_assinados || 0);

    console.log('✅ Estatísticas calculadas com sucesso');

    res.json({
      success: true,
      data: {
        geral: {
          total_assinados: totalAssinados,
          total_campus: 0
        },
        por_campus: []
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor ao buscar estatísticas',
      error: error.message
    });
  }
});





// Servir o frontend build (React)
const clientBuildPath = path.join(__dirname, '../client/build');

app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});


// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Termo de Responsabilidade API'
  });
});

// Iniciar servidor
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`📁 Servindo arquivos estáticos de: ${path.join(__dirname, 'public', 'assinados')}`);
  console.log(`🔗 Health check: ${host}/api/health`);
  console.log(`📋 Endpoint validados: ${host}/api/validados`);
});

module.exports = app;
