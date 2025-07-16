// Backend ASSINATURA FINAL CORRIGIDO - Assinatura apenas no final após assinar
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const dayjs = require('dayjs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use('/assinados', express.static(path.join(__dirname, 'public', 'assinados')));

// Configuração do banco PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

// Função para medir texto
function medirTexto(texto, font, tamanho) {
  return font.widthOfTextAtSize(texto, tamanho);
}

// Função para quebrar texto justificado
function quebrarTextoJustificado(texto, font, tamanho, larguraMaxima) {
  const palavras = texto.split(' ');
  const linhas = [];
  let linhaAtual = '';

  for (const palavra of palavras) {
    const testeLinhaAtual = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
    const larguraTesteLinhaAtual = medirTexto(testeLinhaAtual, font, tamanho);

    if (larguraTesteLinhaAtual <= larguraMaxima) {
      linhaAtual = testeLinhaAtual;
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

// Função para desenhar texto justificado
function desenharTextoJustificado(page, linhas, x, y, tamanho, font, larguraMaxima) {
  let yAtual = y;

  linhas.forEach((linha, index) => {
    const ehUltimaLinha = index === linhas.length - 1;
    
    if (ehUltimaLinha) {
      // Última linha não justificada
      page.drawText(linha, {
        x: x,
        y: yAtual,
        size: tamanho,
        font: font,
        color: rgb(0, 0, 0),
      });
    } else {
      // Justificar linha
      const palavras = linha.split(' ');
      if (palavras.length === 1) {
        page.drawText(linha, {
          x: x,
          y: yAtual,
          size: tamanho,
          font: font,
          color: rgb(0, 0, 0),
        });
      } else {
        const larguraTexto = medirTexto(linha.replace(/ /g, ''), font, tamanho);
        const espacoExtra = larguraMaxima - larguraTexto;
        const espacoEntrePalavras = espacoExtra / (palavras.length - 1);
        
        let xAtual = x;
        palavras.forEach((palavra, i) => {
          page.drawText(palavra, {
            x: xAtual,
            y: yAtual,
            size: tamanho,
            font: font,
            color: rgb(0, 0, 0),
          });
          
          if (i < palavras.length - 1) {
            xAtual += medirTexto(palavra, font, tamanho) + espacoEntrePalavras;
          }
        });
      }
    }
    
    yAtual -= 18; // Espaçamento entre linhas
  });

  return yAtual;
}

// Função para processar texto com campos dinâmicos
function processarTextoComCampos(template, dados, font, tamanho, larguraMaxima) {
  let textoProcessado = template;
  
  // Substituir campos dinâmicos
  Object.keys(dados).forEach(campo => {
    const regex = new RegExp(`{${campo}}`, 'g');
    textoProcessado = textoProcessado.replace(regex, dados[campo]);
  });
  
  return quebrarTextoJustificado(textoProcessado, font, tamanho, larguraMaxima);
}

// 🔍 ENDPOINT: Buscar inscrito por CPF
app.get('/api/inscrito/:cpf', async (req, res) => {
  const { cpf } = req.params;
  
  console.log(`🔍 Buscando inscrito com CPF: ${cpf}`);
  
  try {
    const result = await pool.query(
      'SELECT * FROM inscritos WHERE documento = $1',
      [cpf]
    );

    if (result.rows.length === 0) {
      console.log(`❌ Inscrito não encontrado para CPF: ${cpf}`);
      return res.status(404).json({ error: 'Inscrito não encontrado' });
    }

    const inscrito = result.rows[0];
    
    // Verificação correta de assinatura
    console.log(`📋 Dados do inscrito:`, {
      nome: inscrito.nome_completo,
      cpf: inscrito.documento,
      assinatura_realizada: inscrito.assinatura_realizada,
      pdf_path: inscrito.pdf_path,
      tipo_assinatura: typeof inscrito.assinatura_realizada
    });
    
    // Verificar se realmente foi assinado
    const foiAssinado = inscrito.assinatura_realizada === true || inscrito.assinatura_realizada === 't';
    const temPDF = inscrito.pdf_path && inscrito.pdf_path.trim() !== '';
    
    console.log(`✅ Verificação de assinatura:`, {
      foiAssinado,
      temPDF,
      statusFinal: foiAssinado && temPDF
    });

    // Adicionar URL do PDF se existir
    if (temPDF) {
      inscrito.pdf_url = inscrito.pdf_path;
      console.log(`🔗 URL do PDF: http://localhost:3001${inscrito.pdf_url}`);
    }

    console.log(`📤 Retornando dados do inscrito para o frontend`);
    res.json(inscrito);
    
  } catch (error) {
    console.error('❌ Erro ao buscar inscrito:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📄 ENDPOINT: Gerar termo de responsabilidade
app.post('/api/gerar-termo', async (req, res) => {
  const { cpf, contato_nome, contato_telefone, dados_editados } = req.body;
  
  console.log(`📄 Gerando termo para CPF: ${cpf}`);
  console.log(`📞 Contato de emergência: ${contato_nome} - ${contato_telefone}`);
  
  try {
    // Buscar dados do inscrito
    const result = await pool.query(
      'SELECT * FROM inscritos WHERE documento = $1',
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inscrito não encontrado' });
    }

    let inscrito = result.rows[0];
    
    // Aplicar dados editados se fornecidos
    if (dados_editados) {
      console.log(`✏️ Aplicando dados editados:`, dados_editados);
      
      // Atualizar no banco
      await pool.query(
        'UPDATE inscritos SET nome_completo = $1, responsavel = $2, tel_responsavel = $3 WHERE documento = $4',
        [
          dados_editados.nome_completo || inscrito.nome_completo,
          dados_editados.responsavel || inscrito.responsavel,
          dados_editados.tel_responsavel || inscrito.tel_responsavel,
          cpf
        ]
      );
      
      // Atualizar objeto local
      inscrito.nome_completo = dados_editados.nome_completo || inscrito.nome_completo;
      inscrito.responsavel = dados_editados.responsavel || inscrito.responsavel;
      inscrito.tel_responsavel = dados_editados.tel_responsavel || inscrito.tel_responsavel;
    }
    
    // Salvar contato de emergência
    await pool.query(
      'UPDATE inscritos SET contato_nome = $1, contato_telefone = $2 WHERE documento = $3',
      [contato_nome, contato_telefone, cpf]
    );
    
    // Dados para o PDF
    const dados = {
      NOME_FILHO: inscrito.nome_completo,
      NOME_RESPONSAVEL: inscrito.responsavel,
      CONTATO_NOME: contato_nome,
      CONTATO_TELEFONE: contato_telefone,
      DATA: dayjs().format('DD/MM/YYYY')
    };
    
    console.log(`📝 Dados para o PDF:`, dados);
    
    // Criar PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Configurações
    const fontSize = 11;
    const margin = 50;
    const pageWidth = 595.28; // A4
    const pageHeight = 841.89; // A4
    const textWidth = pageWidth - (margin * 2);
    
    // Página 1
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin - 20;
    
    // Título
    const titulo = 'TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO';
    const tituloWidth = medirTexto(titulo, fontBold, 14);
    page1.drawText(titulo, {
      x: (pageWidth - tituloWidth) / 2,
      y: yPosition,
      size: 14,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    
    yPosition -= 40;
    
    // Subtítulo
    const subtitulo = 'ACAMP RELEVANTE JUNIORS 2025';
    const subtituloWidth = medirTexto(subtitulo, fontBold, 12);
    page1.drawText(subtitulo, {
      x: (pageWidth - subtituloWidth) / 2,
      y: yPosition,
      size: 12,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    
    yPosition -= 50;
    
    // 🔧 CONTEÚDO DO TERMO SEM ÁREA DE ASSINATURA
    const conteudoTermo = [
      `Eu, {NOME_RESPONSAVEL}, responsável pelo(a) menor {NOME_FILHO}, autorizo sua participação no ACAMP RELEVANTE JUNIORS 2025, que será realizado nos dias24 a 26 de julho de 2025 no Centro de Treinamento Oração e Comunhão - CTOC , Campo Grande/MS.`, 
      
      `Autorizo os responsáveis pelo ACAMP RELEVANTE JUNIORS 2025, em caso de acidente ou problemas de saúde, a conduzir meu/minha filho(a) para os primeiros socorros em qualquer Pronto Socorro de Campo Grande/MS, se necessário.`,
      
      `Autorizo o uso da imagem registrada em foto ou vídeo do acampante, sem finalidade comercial, para postagens nas redes sociais (Instagram, Facebook e site oficial da Igreja Evangélica Comunidade Global) do ACAMP RELEVANTE JUNIORS 2025, sendo que a autorização se limita às imagens registradas no contexto do acampamento e suas programações. `,

      `Estou ciente de que, no caso de extravio de qualquer objeto de valor em posse do acampante (câmera fotográfica, celular, lanterna, relógio, etc.), não haverá reembolso, sendo de minha total responsabilidade. `,
      
      `Estou ciente de que será de minha responsabilidade todo e qualquer dano material contra o patrimônio do CTOC (local de realização do ACAMP RELEVANTE JUNIORS 2025), desde que comprovada a responsabilidade do meu/minha filho(a) no ocorrido. `,
      
      `Estou ciente de que, com o objetivo de contribuir para o bom aproveitamento dos acampantes, NÃO é aconselhável a visita/presença ou comunicação telefônica por parte dos pais, responsáveis ou parentes durante a temporada.`,
      
      `Em caso de emergência, a coordenação do ACAMP RELEVANTE JUNIORS 2025 entrará em contato com os responsáveis.`,
    
      `Em caso de ausência, autorizo a coordenação do ACAMP RELEVANTE JUNIORS 2025 a entrar em contato com a seguinte pessoa: NOME: {CONTATO_NOME} TELEFONE: {CONTATO_TELEFONE}`,

      `Estou ciente de que, em caso de mau comportamento ou desobediência às regras do ACAMP RELEVANTE JUNIORS 2025, o responsável deverá buscar o adolescente no evento, sem direito a devolução do valor da inscrição.`,

      `Estou ciente de que, será proibido o uso de celular durante o acampamento, sendo o uso e zelo do aparelho de total responsabilidade dele(a), assim como as consequências de seu uso indevido.`,

      `Declaro que li e compreendi todos os termos acima, concordando integralmente com as condições estabelecidas. Isento a organização do evento de qualquer responsabilidade por danos pessoais ou materiais, desde que comprovada a responsabilidade do meu(minha) filho(a) no ocorrido.`
  ];

    // Desenhar conteúdo
    conteudoTermo.forEach((paragrafo, index) => {
      const linhas = processarTextoComCampos(paragrafo, dados, font, fontSize, textWidth);
      yPosition = desenharTextoJustificado(page1, linhas, margin, yPosition, fontSize, font, textWidth);
      yPosition -= 15; // Espaço entre parágrafos
      
      // Se chegou no final da página, criar nova página
      if (yPosition < 100 && index < conteudoTermo.length - 1) {
        const page2 = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margin - 20;
        
        // Continuar na página 2...
      }
    });
    
    // 🔧 APENAS DATA E LOCAL NO FINAL (SEM ÁREA DE ASSINATURA)
    yPosition -= 100;
    
    // Data e local
    const dataLocal = `Campo Grande/MS, {DATA}`;
    const linhasDataLocal = processarTextoComCampos(dataLocal, dados, font, fontSize, textWidth);
    desenharTextoJustificado(page1, linhasDataLocal, margin, yPosition, fontSize, font, textWidth);
    
    console.log(`📝 PDF inicial criado SEM área de assinatura`);
    
    // Salvar PDF
    const pdfBytes = await pdfDoc.save();
    
    // Criar diretório se não existir
    const assinadosDir = path.join(__dirname, 'public', 'assinados');
    try {
      await fs.access(assinadosDir);
    } catch {
      await fs.mkdir(assinadosDir, { recursive: true });
    }
    
    // Salvar arquivo
    const nomeArquivo = `${cpf}.pdf`;
    const caminhoCompleto = path.join(assinadosDir, nomeArquivo);
    await fs.writeFile(caminhoCompleto, pdfBytes);
    
    // Salvar caminho correto no banco
    const pdfPath = `/assinados/${nomeArquivo}`;
    await pool.query(
      'UPDATE inscritos SET pdf_path = $1, assinatura_realizada = false WHERE documento = $2',
      [pdfPath, cpf]
    );
    
    console.log(`✅ PDF gerado com sucesso: ${pdfPath}`);
    console.log(`🔗 URL de acesso: http://localhost:3001${pdfPath}`);
    console.log(`🔄 Assinatura resetada para false`);
    
    // Retornar dados atualizados
    const inscritoAtualizado = {
      ...inscrito,
      contato_nome,
      contato_telefone,
      pdf_path: pdfPath,
      pdf_url: pdfPath,
      assinatura_realizada: false
    };
    
    res.json(inscritoAtualizado);
    
  } catch (error) {
    console.error('❌ Erro ao gerar termo:', error);
    res.status(500).json({ error: 'Erro ao gerar termo' });
  }
});

// 🆕 ENDPOINT: Listar termos validados (assinados) - CAMPOS CORRETOS
app.get('/api/validados', async (req, res) => {
  try {
    console.log('🔍 Buscando termos validados...');
    
    const { busca, campus, page = 1, limit = 20 } = req.query;
    
    let query = `
      SELECT 
        id,
        nome_completo,
        documento,
        email,
        celular,
        data_nascimento,
        campus,
        idade,
        responsavel,
        tel_responsavel,
        lider_celula,
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
    
    // Filtro por busca (nome ou CPF)
    if (busca && busca.trim() !== '') {
      paramCount++;
      query += ` AND (nome_completo ILIKE $${paramCount} OR documento ILIKE $${paramCount})`;
      params.push(`%${busca.trim()}%`);
    }
    
    // Filtro por campus
    if (campus && campus.trim() !== '') {
      paramCount++;
      query += ` AND campus ILIKE $${paramCount}`;
      params.push(`%${campus.trim()}%`);
    }
    
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
    
    console.log('📋 Query executada:', query);
    console.log('📋 Parâmetros:', params);
    
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
      countQuery += ` AND (nome_completo ILIKE $${countParamCount} OR documento ILIKE $${countParamCount})`;
      countParams.push(`%${busca.trim()}%`);
    }
    
    if (campus && campus.trim() !== '') {
      countParamCount++;
      countQuery += ` AND campus ILIKE $${countParamCount}`;
      countParams.push(`%${campus.trim()}%`);
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);
    
    // Processar resultados
    const validados = result.rows.map(inscrito => ({
      ...inscrito,
      pdf_url: inscrito.pdf_path,
      data_assinatura: inscrito.updated_at,
      cpf_formatado: inscrito.documento.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
      data_nascimento_formatada: inscrito.data_nascimento ? 
        new Date(inscrito.data_nascimento).toLocaleDateString('pt-BR') : 'N/A'
    }));
    
    console.log(`✅ Encontrados ${validados.length} termos validados de ${total} total`);
    
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
        busca,
        campus
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

// 🆕 ENDPOINT: Estatísticas dos validados - CAMPOS CORRETOS
app.get('/api/validados/stats', async (req, res) => {
  try {
    console.log('📊 Buscando estatísticas dos validados...');
    
    const statsQuery = `
      SELECT 
        COUNT(*) as total_assinados,
        COUNT(DISTINCT campus) as total_campus,
        campus,
        COUNT(*) as total_por_campus
      FROM inscritos 
      WHERE assinatura_realizada = true 
      AND pdf_path IS NOT NULL 
      AND pdf_path != ''
      GROUP BY ROLLUP(campus)
      ORDER BY campus NULLS LAST
    `;
    
    const result = await pool.query(statsQuery);
    
    // Separar estatísticas gerais e por campus
    const estatisticasGerais = result.rows.find(row => row.campus === null);
    const estatisticasPorCampus = result.rows.filter(row => row.campus !== null);
    
    console.log('✅ Estatísticas calculadas com sucesso');
    
    res.json({
      success: true,
      data: {
        geral: {
          total_assinados: parseInt(estatisticasGerais?.total_assinados || 0),
          total_campus: parseInt(estatisticasGerais?.total_campus || 0)
        },
        por_campus: estatisticasPorCampus.map(stat => ({
          campus: stat.campus,
          total: parseInt(stat.total_por_campus)
        }))
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

// ✍️ ENDPOINT: Atualizar assinatura
app.post('/api/atualizar-assinatura', async (req, res) => {
  const { cpf, assinatura } = req.body;
  
  console.log(`✍️ Adicionando assinatura para CPF: ${cpf}`);
  
  try {
    // Buscar dados do inscrito
    const result = await pool.query(
      'SELECT * FROM inscritos WHERE documento = $1',
      [cpf]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inscrito não encontrado' });
    }

    const inscrito = result.rows[0];
    
    if (!inscrito.pdf_path) {
      return res.status(400).json({ error: 'PDF não foi gerado ainda' });
    }
    
    // Construir caminho físico correto
    const caminhoFisico = path.join(__dirname, 'public', inscrito.pdf_path.replace('/assinados/', 'assinados/'));
    console.log(`📁 Caminho físico do PDF: ${caminhoFisico}`);
    
    const pdfExistente = await fs.readFile(caminhoFisico);
    const pdfDoc = await PDFDocument.load(pdfExistente);
    
    // Converter assinatura base64 para imagem
    const assinaturaBase64 = assinatura.replace(/^data:image\/png;base64,/, '');
    const assinaturaBytes = Buffer.from(assinaturaBase64, 'base64');
    const pngImage = await pdfDoc.embedPng(assinaturaBytes);
    
    // Obter última página
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { height } = lastPage.getSize();
    
    // Dados para assinatura
    const dados = {
      nomeResponsavel: inscrito.responsavel,
      data: dayjs().format('DD/MM/YYYY')
    };
    
    // 🔧 ADICIONAR ÁREA DE ASSINATURA NO FINAL DO DOCUMENTO
    console.log(`✍️ Adicionando área de assinatura no final do documento`);
    
    // Espaço antes da assinatura
    const yAssinatura = height - 700; // Posição no final da página
    
    // Adicionar assinatura digital
    lastPage.drawImage(pngImage, {
      x: 50,
      y: yAssinatura,
      width: 300,
      height: 60,
    });
    
    // Adicionar texto da assinatura
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    lastPage.drawText(`Assinatura do responsável: ${dados.nomeResponsavel}`, {
      x: 50,
      y: yAssinatura - 20,
      size: 10,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    
    
    console.log(`✅ Área de assinatura adicionada no final do documento`);
    
    // Salvar PDF atualizado
    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(caminhoFisico, pdfBytes);
    
    // Atualizar banco com assinatura = true
    await pool.query(
      'UPDATE inscritos SET assinatura_realizada = true WHERE documento = $1',
      [cpf]
    );
    
    console.log(`✅ Assinatura adicionada com sucesso para CPF: ${cpf}`);
    console.log(`✅ Campo assinatura_realizada atualizado para TRUE`);
    console.log(`🔗 PDF atualizado disponível em: http://localhost:3001${inscrito.pdf_path}`);
    
    res.json({ 
      success: true, 
      message: 'Assinatura adicionada com sucesso',
      pdf_url: inscrito.pdf_path
    });
    
  } catch (error) {
    console.error('❌ Erro ao atualizar assinatura:', error);
    res.status(500).json({ error: 'Erro ao adicionar assinatura' });
  }
});

// Servir o frontend build (React)
const clientBuildPath = path.join(__dirname, '../client/build');

app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});


// Iniciar servidor
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  console.log(`📁 Servindo arquivos estáticos de: ${path.join(__dirname, 'public', 'assinados')}`);
  console.log(`🔗 URLs dos PDFs: http://localhost:${port}/assinados/ARQUIVO.pdf`);
});

module.exports = app;

