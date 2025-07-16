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
const port = process.env.PORT || 3001;

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
    const testeLinhaAtual = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
    const larguraTesteLinhaAtual = font.widthOfTextAtSize(testeLinhaAtual, tamanho);

    if (larguraTesteLinhaAtual <= larguraMaxima) {
      linhaAtual = testeLinhaAtual;
    } else {
      if (linhaAtual) {
        linhas.push(linhaAtual);
        linhaAtual = palavra;
      } else {
        // Palavra muito longa, quebrar forçadamente
        linhas.push(palavra);
      }
    }
  }

  if (linhaAtual) {
    linhas.push(linhaAtual);
  }

  return linhas;
}

// 🔧 Função melhorada para desenhar texto justificado
function desenharTextoJustificado(page, texto, x, y, tamanho, font, larguraMaxima, espacoEntreLinhas = 16) {
  const linhas = quebrarTexto(texto, font, tamanho, larguraMaxima);
  let yAtual = y;

  linhas.forEach((linha, index) => {
    const ehUltimaLinha = index === linhas.length - 1;
    
    if (ehUltimaLinha || linha.split(' ').length === 1) {
      // Última linha ou linha com uma palavra: não justificar
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
      const larguraTextoSemEspacos = palavras.reduce((total, palavra) => {
        return total + font.widthOfTextAtSize(palavra, tamanho);
      }, 0);
      
      const espacoTotal = larguraMaxima - larguraTextoSemEspacos;
      const espacoEntrePalavras = espacoTotal / (palavras.length - 1);
      
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
          xAtual += font.widthOfTextAtSize(palavra, tamanho) + espacoEntrePalavras;
        }
      });
    }
    
    yAtual -= espacoEntreLinhas;
  });

  return yAtual;
}

// 🔧 Função para processar texto com campos dinâmicos
function processarCampos(texto, dados) {
  let textoProcessado = texto;
  
  Object.keys(dados).forEach(campo => {
    const regex = new RegExp(`{${campo}}`, 'g');
    textoProcessado = textoProcessado.replace(regex, dados[campo]);
  });
  
  return textoProcessado;
}

// Endpoint para buscar inscrito por CPF
app.get('/api/inscrito/:cpf', async (req, res) => {
  try {
    const { cpf } = req.params;
    console.log(`🔍 Buscando inscrito com CPF: ${cpf}`);
    
    const result = await pool.query('SELECT * FROM inscritos WHERE documento = $1', [cpf]);
    
    if (result.rows.length === 0) {
      console.log(`❌ Inscrito não encontrado para CPF: ${cpf}`);
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
      });
    }
    
    const inscrito = result.rows[0];
    
    console.log(`📋 Dados do inscrito:`, {
      nome: inscrito.nome_completo,
      cpf: inscrito.documento,
      assinatura_realizada: inscrito.assinatura_realizada,
      pdf_path: inscrito.pdf_path,
      tipo_assinatura: typeof inscrito.assinatura_realizada
    });
    
    // Verificar se já foi assinado
    const foiAssinado = inscrito.assinatura_realizada === true || inscrito.assinatura_realizada === 't';
    const temPDF = inscrito.pdf_path && inscrito.pdf_path.trim() !== '';
    
    console.log(`✅ Verificação de assinatura:`, {
      foiAssinado,
      temPDF,
      statusFinal: foiAssinado && temPDF
    });
    
    if (foiAssinado && temPDF) {
      console.log(`✅ Termo já assinado para CPF: ${cpf}`);
      return res.json({
        success: true,
        data: inscrito,
        ja_assinado: true,
        pdf_url: inscrito.pdf_path,
        message: 'Este CPF já possui termo de responsabilidade assinado'
      });
    }
    
    console.log(`📤 Retornando dados do inscrito para o frontend`);
    res.json({
      success: true,
      data: inscrito,
      ja_assinado: false
    });
    
  } catch (error) {
    console.error('❌ Erro ao buscar inscrito:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para atualizar dados do inscrito
app.put('/api/inscrito/:cpf', async (req, res) => {
  try {
    const { cpf } = req.params;
    const { nome_completo, responsavel, tel_responsavel, contato_nome, contato_telefone } = req.body;
    
    console.log(`🔄 Atualizando dados do inscrito CPF: ${cpf}`);
    console.log(`📝 Novos dados:`, { nome_completo, responsavel, tel_responsavel, contato_nome, contato_telefone });
    
    const updateQuery = `
      UPDATE inscritos 
      SET nome_completo = $1, responsavel = $2, tel_responsavel = $3, contato_nome = $4, contato_telefone = $5
      WHERE documento = $6
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [
      nome_completo, responsavel, tel_responsavel, contato_nome, contato_telefone, cpf
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
      });
    }
    
    console.log(`✅ Dados atualizados com sucesso para CPF: ${cpf}`);
    
    res.json({
      success: true,
      data: result.rows[0],
      message: 'Dados atualizados com sucesso'
    });
    
  } catch (error) {
    console.error('❌ Erro ao atualizar dados:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// 🔧 Endpoint corrigido para gerar PDF
app.post('/api/gerar-pdf', async (req, res) => {
  try {
    const { cpf, contato_nome, contato_telefone, dados_editados } = req.body;
    
    console.log(`📄 Gerando PDF para CPF: ${cpf}`);
    console.log(`📞 Contato de emergência:`, { contato_nome, contato_telefone });
    
    // Buscar dados do inscrito
    const result = await pool.query('SELECT * FROM inscritos WHERE documento = $1', [cpf]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
      });
    }
    
    let inscrito = result.rows[0];
    
    // Se há dados editados, usar eles
    if (dados_editados) {
      inscrito = { ...inscrito, ...dados_editados };
    }
    
    // Atualizar contato de emergência no banco
    await pool.query(
      'UPDATE inscritos SET contato_nome = $1, contato_telefone = $2 WHERE documento = $3',
      [contato_nome, contato_telefone, cpf]
    );
    
    // Se há dados editados, atualizar no banco também
    if (dados_editados) {
      await pool.query(
        'UPDATE inscritos SET nome_completo = $1, responsavel = $2, tel_responsavel = $3 WHERE documento = $4',
        [dados_editados.nome_completo, dados_editados.responsavel, dados_editados.tel_responsavel, cpf]
      );
    }
    
    // Dados para o PDF
    const dados = {
      NOME_FILHO: inscrito.nome_completo || 'NÃO INFORMADO',
      NOME_RESPONSAVEL: inscrito.responsavel || 'NÃO INFORMADO',
      CONTATO_NOME: contato_nome || 'NÃO INFORMADO',
      CONTATO_TELEFONE: contato_telefone || 'NÃO INFORMADO',
      DATA: dayjs().format('DD/MM/YYYY'),
    };
    
    console.log(`📝 Dados para o PDF:`, dados);
    
    // 🔧 CRIAR PDF CORRIGIDO
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Configurações da página
    const pageWidth = 595.28; // A4
    const pageHeight = 841.89; // A4
    const margin = 50;
    const textWidth = pageWidth - (margin * 2);
    const fontSize = 11;
    const titleFontSize = 16;
    const subtitleFontSize = 14;
    
    // Primeira página
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin - 30;
    
    // 🔧 TÍTULO CENTRALIZADO
    const titulo = 'TERMO DE RESPONSABILIDADE E AUTORIZAÇÃO';
    const tituloWidth = font.widthOfTextAtSize(titulo, titleFontSize);
    page1.drawText(titulo, {
      x: (pageWidth - tituloWidth) / 2,
      y: yPosition,
      size: titleFontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    
    yPosition -= 30;
    
    // 🔧 SUBTÍTULO CENTRALIZADO
    const subtitulo = 'ACAMP RELEVANTE JUNIORS 2025';
    const subtituloWidth = font.widthOfTextAtSize(subtitulo, subtitleFontSize);
    page1.drawText(subtitulo, {
      x: (pageWidth - subtituloWidth) / 2,
      y: yPosition,
      size: subtitleFontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    
    yPosition -= 50;
    
    // 🔧 CONTEÚDO DO TERMO CORRIGIDO
    const paragrafos = [
      `Eu, {NOME_RESPONSAVEL}, responsável pelo(a) menor {NOME_FILHO}, autorizo sua participação no ACAMP RELEVANTE JUNIORS 2025, que será realizado nos dias 24 a 26 de julho de 2025 no Centro de Treinamento Oração e Comunhão - CTOC, Campo Grande/MS.`,
      
      `Autorizo os responsáveis pelo ACAMP RELEVANTE JUNIORS 2025, em caso de acidente ou problemas de saúde, a conduzir meu/minha filho(a) para os primeiros socorros em qualquer Pronto Socorro de Campo Grande/MS, se necessário.`,
      
      `Autorizo o uso da imagem registrada em foto ou vídeo do acampante, sem finalidade comercial, para postagens nas redes sociais (Instagram, Facebook e site oficial da Igreja Evangélica Comunidade Global) do ACAMP RELEVANTE JUNIORS 2025, sendo que a autorização se limita às imagens registradas no contexto do acampamento e suas programações.`,
      
      `Estou ciente de que, no caso de extravio de qualquer objeto de valor em posse do acampante (câmera fotográfica, celular, lanterna, relógio, etc.), não haverá reembolso, sendo de minha total responsabilidade.`,
      
      `Estou ciente de que será de minha responsabilidade todo e qualquer dano material contra o patrimônio do CTOC (local de realização do ACAMP RELEVANTE JUNIORS 2025), desde que comprovada a responsabilidade do meu/minha filho(a) no ocorrido.`,
      
      `Estou ciente de que, com o objetivo de contribuir para o bom aproveitamento dos acampantes, NÃO é aconselhável a visita/presença ou comunicação telefônica por parte dos pais, responsáveis ou parentes durante a temporada.`,
      
      `Em caso de emergência, a coordenação do ACAMP RELEVANTE JUNIORS 2025 entrará em contato com os responsáveis.`,
      
      `Em caso de ausência, autorizo a coordenação do ACAMP RELEVANTE JUNIORS 2025 a entrar em contato com a seguinte pessoa: NOME: {CONTATO_NOME} TELEFONE: {CONTATO_TELEFONE}`,
      
      `Estou ciente de que, em caso de mau comportamento ou desobediência às regras do ACAMP RELEVANTE JUNIORS 2025, o responsável deverá buscar o adolescente no evento, sem direito a devolução do valor da inscrição.`,
      
      `Estou ciente de que será proibido o uso de celular durante o acampamento, sendo o uso e zelo do aparelho de total responsabilidade dele(a), assim como as consequências de seu uso indevido.`,
      
      `Declaro que li e compreendi todos os termos acima, concordando integralmente com as condições estabelecidas. Isento a organização do evento de qualquer responsabilidade por danos pessoais ou materiais, desde que comprovada a responsabilidade do meu(minha) filho(a) no ocorrido.`
    ];
    
    // 🔧 DESENHAR PARÁGRAFOS COM FORMATAÇÃO CORRETA
    paragrafos.forEach((paragrafo, index) => {
      // Processar campos dinâmicos
      const textoProcessado = processarCampos(paragrafo, dados);
      
      // Desenhar parágrafo justificado
      yPosition = desenharTextoJustificado(page1, textoProcessado, margin, yPosition, fontSize, font, textWidth, 16);
      
      // Espaço entre parágrafos
      yPosition -= 10;
      
      // Se chegou no final da página, criar nova página
      if (yPosition < 150 && index < paragrafos.length - 1) {
        const page2 = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margin - 30;
        
        // Continuar na página 2
        page1 = page2; // Redirecionar para a nova página
      }
    });
    
    // 🔧 DATA E LOCAL NO FINAL (SEM ÁREA DE ASSINATURA)
    yPosition -= 30;
    
    const dataLocal = `Campo Grande/MS, ${dados.DATA}`;
    page1.drawText(dataLocal, {
      x: margin,
      y: yPosition,
      size: fontSize,
      font: font,
      color: rgb(0, 0, 0),
    });
    
    console.log(`📝 PDF inicial criado SEM área de assinatura`);
    
    // Salvar PDF
    const pdfBytes = await pdfDoc.save();
    
    // Criar diretório se não existir
    const diretorioAssinados = path.join(__dirname, 'public', 'assinados');
    try {
      await fs.access(diretorioAssinados);
    } catch {
      await fs.mkdir(diretorioAssinados, { recursive: true });
    }
    
    // Salvar arquivo
    const nomeArquivo = `${cpf}.pdf`;
    const caminhoCompleto = path.join(diretorioAssinados, nomeArquivo);
    await fs.writeFile(caminhoCompleto, pdfBytes);
    
    // Atualizar banco com caminho correto (sem /public)
    const pdfPath = `/assinados/${nomeArquivo}`;
    await pool.query(
      'UPDATE inscritos SET pdf_path = $1, assinatura_realizada = false WHERE documento = $2',
      [pdfPath, cpf]
    );
    
    console.log(`✅ PDF gerado com sucesso: ${pdfPath}`);
    console.log(`🔗 URL de acesso: http://localhost:3001${pdfPath}`);
    console.log(`📁 Caminho físico do PDF: ${caminhoCompleto}`);
    
    res.json({
      success: true,
      pdf_url: pdfPath,
      message: 'PDF gerado com sucesso'
    });
    
  } catch (error) {
    console.error('❌ Erro ao gerar PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Endpoint para atualizar assinatura
app.post('/api/atualizar-assinatura', async (req, res) => {
  try {
    const { cpf, assinatura } = req.body;
    
    console.log(`✍️ Atualizando assinatura para CPF: ${cpf}`);
    
    // Buscar dados do inscrito
    const result = await pool.query('SELECT * FROM inscritos WHERE documento = $1', [cpf]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inscrito não encontrado'
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
    
    console.log(`📁 Caminho físico do PDF: ${caminhoFisico}`);
    
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
      nomeResponsavel: inscrito.responsavel || 'NÃO INFORMADO',
      data: dayjs().format('DD/MM/YYYY')
    };
    
    // 🔧 POSIÇÃO CORRETA DA ASSINATURA (NO FINAL DO DOCUMENTO)
    const yAssinatura = 150; // Posição fixa no final da página
    
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
      size: 11,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    
    lastPage.drawText(`Data: ${dados.data}`, {
      x: 50,
      y: yAssinatura - 40,
      size: 11,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    
    // Salvar PDF atualizado
    const pdfBytesAtualizados = await pdfDoc.save();
    await fs.writeFile(caminhoFisico, pdfBytesAtualizados);
    
    // Atualizar status no banco
    await pool.query(
      'UPDATE inscritos SET assinatura_realizada = true WHERE documento = $1',
      [cpf]
    );
    
    console.log(`✅ Assinatura adicionada com sucesso para CPF: ${cpf}`);
    
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
    
    const { busca, campus, page = 1, limit = 50 } = req.query;
    
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

// 🆕 ENDPOINT: Estatísticas dos validados
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
  console.log(`🔗 Health check: http://localhost:${port}/api/health`);
  console.log(`📋 Endpoint validados: http://localhost:${port}/api/validados`);
});

module.exports = app;

