// App.jsx DADOS CORRIGIDO - Preenchimento correto dos dados do inscrito
import React, { useState, useRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import Validados from './Validados';
import './App.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:3001';

function App() {
  const [busca, setBusca] = useState('');
  const [inscrito, setInscrito] = useState(null);
  const [listaInscritos, setListaInscritos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Estados para contato de emergência (obrigatório)
  const [contatoEmergencia, setContatoEmergencia] = useState({
    nome: '',
    telefone: ''
  });
  
  // Estados para edição simplificada (opcional)
  const [modoEdicao, setModoEdicao] = useState(false);
  const [dadosEditados, setDadosEditados] = useState({
    nome_completo: '',
    nome_responsavel: '',
    tel_responsavel: ''
  });
  
  // Estados de controle
  const [etapa, setEtapa] = useState('busca'); // 'busca', 'contato_emergencia', 'termo_gerado', 'ja_assinado'
  const [gerandoTermo, setGerandoTermo] = useState(false);

  // Estado para controle de rota
  const [rotaAtual, setRotaAtual] = useState('home');
  
  const sigCanvas = useRef(null);

  // Efeito para detectar rota na URL
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/validados') {
      setRotaAtual('validados');
    } else {
      setRotaAtual('home');
    }
    
    // Listener para mudanças na URL
    const handlePopState = () => {
      const newPath = window.location.pathname;
      if (newPath === '/validados') {
        setRotaAtual('validados');
      } else {
        setRotaAtual('home');
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const inscritoEstaAssinado = (inscritoData) => {
    const assinaturaRealizada = inscritoData?.assinatura_realizada === true || inscritoData?.assinatura_realizada === 't';
    const caminhoPdf = inscritoData?.pdf_path || inscritoData?.pdf_url || '';
    const temPdf = typeof caminhoPdf === 'string' ? caminhoPdf.trim() !== '' : Boolean(caminhoPdf);
    return assinaturaRealizada && temPdf;
  };

  const assinaturaDisponivel = () => (
    Boolean(sigCanvas.current)
    && typeof sigCanvas.current.isEmpty === 'function'
    && typeof sigCanvas.current.clear === 'function'
    && typeof sigCanvas.current.toDataURL === 'function'
  );

  const prepararInscritoSelecionado = (inscritoData, forcarJaAssinado = false) => {
    console.log('👤 Dados do inscrito recebidos:', inscritoData);
    setInscrito(inscritoData);
    setModoEdicao(false);

    setDadosEditados({
      nome_completo: inscritoData.nome_completo || '',
      nome_responsavel: inscritoData.nome_responsavel || inscritoData.responsavel || '',
      tel_responsavel: inscritoData.telefone_responsavel || inscritoData.tel_responsavel || ''
    });

    setContatoEmergencia({
      nome: inscritoData.contato_nome || '',
      telefone: inscritoData.contato_telefone || ''
    });

    if (forcarJaAssinado || inscritoEstaAssinado(inscritoData)) {
      console.log('📋 Termo já assinado, indo para tela de visualização');
      setEtapa('ja_assinado');
      setSuccess('Termo já foi assinado anteriormente!');
      return;
    }

    setEtapa('contato_emergencia');
    setSuccess('Inscrito selecionado. Preencha o contato de emergência.');
  };

  const voltarParaLista = () => {
    if (assinaturaDisponivel() && !sigCanvas.current.isEmpty()) {
      sigCanvas.current.clear();
    }

    setInscrito(null);
    setModoEdicao(false);
    setError('');
    setSuccess('');
    setEtapa('lista_inscritos');
  };

  // Função para buscar inscrito por order_code ou telefone_responsavel
  const buscarInscrito = async () => {
    if (!busca.trim()) {
      setError('Digite order_code (REG-...) ou telefone_responsavel para busca');
      return;
    }

    const valor = busca.trim();

    const orderCodeRegex = /^REG-\d{8}-[A-Z0-9]+$/i;
    const telefoneRegex = /^\d{8,14}$/;

    let order_code = '';
    let telefone_responsavel = '';

    if (orderCodeRegex.test(valor)) {
      order_code = valor.toUpperCase();
    } else if (telefoneRegex.test(valor)) {
      telefone_responsavel = valor;
    } else if (/^[A-Za-z]/.test(valor)) {
      // Aceita order_code parcialmente, mas exige formato correto
      setError('Formato inválido: use REG-YYYYMMDD-[A-Z0-9]+');
      return;
    } else {
      setError('Formato inválido, use order_code ou telefone');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setInscrito(null);
    setEtapa('busca');

    try {
      const params = new URLSearchParams();
      if (order_code) params.append('order_code', order_code);
      if (telefone_responsavel) params.append('telefone_responsavel', telefone_responsavel);

      const url = `${API_BASE_URL}/api/inscrito?${params.toString()}`;
      console.log(`Buscando inscrito com URL: ${url}`);

      const response = await fetch(url);
      const data = await response.json();


      console.log('📋 Resposta do servidor:', data);

      if (data.success) {
        setListaInscritos([]);

        if (data.multiple && Array.isArray(data.data) && data.data.length > 1) {
          setListaInscritos(data.data);
          setEtapa('lista_inscritos');
          setSuccess(data.message || `${data.data.length} inscritos encontrados.`);
          return;
        }

        const inscritoData = Array.isArray(data.data) ? data.data[0] : data.data;
        prepararInscritoSelecionado(inscritoData, Boolean(data.ja_assinado));
      } else {
        console.error('❌ Erro na resposta:', data);
        setError(data.message || 'Inscrito não encontrado');
      }
    } catch (err) {
      console.error('❌ Erro de conexão:', err);
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

  // Função corrigida para gerar termo
  const gerarTermo = async () => {
    // Validar contato de emergência
    if (!contatoEmergencia.nome.trim() || !contatoEmergencia.telefone.trim()) {
      setError('Contato de emergência é obrigatório (nome e telefone)');
      return;
    }

    setGerandoTermo(true);
    setError('');
    setSuccess('');

    try {
      console.log('📄 Gerando termo com dados:', {
        inscrito_id: inscrito.id,
        order_code: inscrito.order_code,
        telefone_responsavel: inscrito.telefone_responsavel,
        contato_nome: contatoEmergencia.nome,
        contato_telefone: contatoEmergencia.telefone,
        dados_editados: modoEdicao ? dadosEditados : null
      });

      const response = await fetch(`${API_BASE_URL}/api/gerar-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inscrito_id: inscrito.id,
          order_code: inscrito.order_code,
          telefone_responsavel: inscrito.telefone_responsavel,
          contato_nome: contatoEmergencia.nome,
          contato_telefone: contatoEmergencia.telefone,
          dados_editados: modoEdicao ? dadosEditados : null
        }),
      });

      const data = await response.json();
      console.log('Resposta da geração de PDF:', data);

      if (data.success) {
        const inscritoAtualizado = {
          ...inscrito,
          pdf_path: data.pdf_url,
          pdf_url: data.pdf_url,
          contato_nome: contatoEmergencia.nome,
          contato_telefone: contatoEmergencia.telefone,
          assinatura_realizada: false
        };

        setInscrito(inscritoAtualizado);
        setListaInscritos((prev) => prev.map((item) => (
          item.id === inscritoAtualizado.id
            ? { ...item, ...inscritoAtualizado }
            : item
        )));

        setEtapa('termo_gerado');
        setModoEdicao(false);
        setSuccess('Termo gerado com sucesso!');
      } else {
        setError(data.message || 'Erro ao gerar termo');
      }
    } catch (err) {
      console.error('Erro ao gerar termo:', err);
      setError('Erro de conexão com o servidor');
    } finally {
      setGerandoTermo(false);
    }
  };

  // Função corrigida para adicionar assinatura
  const adicionarAssinatura = async () => {
    if (!inscrito) {
      setError('Nenhum inscrito selecionado');
      return;
    }

    if (!assinaturaDisponivel() || sigCanvas.current.isEmpty()) {
      setError('Por favor, faça sua assinatura antes de continuar');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const assinaturaDataURL = sigCanvas.current.toDataURL();
      
      console.log('Adicionando assinatura para inscrito:', inscrito.id, inscrito.order_code || inscrito.telefone_responsavel);
      
      const response = await fetch(`${API_BASE_URL}/api/atualizar-assinatura`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inscrito_id: inscrito.id,
          order_code: inscrito.order_code,
          telefone_responsavel: inscrito.telefone_responsavel,
          assinatura: assinaturaDataURL,
        }),
      });

      const data = await response.json();
      console.log('Resposta da assinatura:', data);

      if (data.success) {
        const inscritoAtualizado = {
          ...inscrito,
          assinatura_realizada: true,
          pdf_url: data.pdf_url || inscrito.pdf_url,
          pdf_path: data.pdf_url || inscrito.pdf_path
        };

        setSuccess('Assinatura adicionada com sucesso!');
        setInscrito(inscritoAtualizado);
        setListaInscritos((prev) => prev.map((item) => (
          item.id === inscritoAtualizado.id
            ? { ...item, ...inscritoAtualizado }
            : item
        )));

        if (assinaturaDisponivel()) {
          sigCanvas.current.clear();
        }
        setEtapa('ja_assinado'); // Ir para tela de termo assinado
      } else {
        setError(data.message || 'Erro ao adicionar assinatura');
      }
    } catch (err) {
      console.error('Erro ao adicionar assinatura:', err);
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

  // Função para limpar assinatura
  const limparAssinatura = () => {
    if (assinaturaDisponivel()) {
      sigCanvas.current.clear();
    }
  };

  // Função para voltar à busca
  const voltarBusca = () => {
    setEtapa('busca');
    setInscrito(null);
    setListaInscritos([]);
    setBusca('');
    setContatoEmergencia({ nome: '', telefone: '' });
    setDadosEditados({ nome_completo: '', nome_responsavel: '', tel_responsavel: '' });
    setModoEdicao(false);
    setError('');
    setSuccess('');
  };

  // Função corrigida para baixar PDF
  const baixarPDF = () => {
    if (inscrito && (inscrito.pdf_url || inscrito.pdf_path)) {
      const pdfUrl = inscrito.pdf_url || inscrito.pdf_path;
      const link = document.createElement('a');
      link.href = `${API_BASE_URL}${pdfUrl}`;
      const identifier = inscrito.order_code || inscrito.telefone_responsavel || 'termo';
      link.download = `termo_${identifier}.pdf`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      setError('PDF não encontrado');
    }
  };

  // Função corrigida para visualizar PDF
  const visualizarPDF = () => {
    if (inscrito && (inscrito.pdf_url || inscrito.pdf_path)) {
      const pdfUrl = inscrito.pdf_url || inscrito.pdf_path;
      window.open(`${API_BASE_URL}${pdfUrl}`, '_blank');
    } else {
      setError('PDF não encontrado');
    }
  };

  // Renderizar baseado na rota
  if (rotaAtual === 'validados') {
    return <Validados />;
  }

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>Sistema de Termo de Responsabilidade</h1>
          <p>ACAMP RELEVANTEEN 2026</p>
          
        </header>

        {/* Etapa 1: Busca por order_code ou telefone */}
        {etapa === 'busca' && (
          <div className="search-section">
            <h2>Buscar Inscrito</h2>
            <div className="input-group">
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={'Digite order_code (REG-...) ou telefone do respons\u00E1vel'}
                className="search-input"
                disabled={loading}
              />
              <button
                onClick={buscarInscrito}
                disabled={loading || !busca.trim()}
                className="search-button"
              >
                {loading ? 'Buscando...' : 'Buscar Inscrito'}
              </button>
            </div>
            <small style={{ color: '#555' }}>
              {'Use REG-YYYYMMDD-xxxxxx para order_code ou digite s\u00F3 o n\u00FAmero para telefone.'}
            </small>
          </div>
        )}

        {/* NOVA ETAPA: Selecionar inscrito quando há múltiplos resultados */}
        {etapa === 'lista_inscritos' && listaInscritos.length > 0 && (
          <div className="selection-section">
            <h2>{'V\u00E1rios inscritos encontrados'}</h2>
            <p className="selection-description">
              {'Selecione um inscrito para gerar/assinar o termo. Depois, volte para esta lista e selecione o pr\u00F3ximo.'}
            </p>
            <div className="list-group">
              {listaInscritos.map((item) => (
                <div
                  key={`${item.order_code || item.telefone_responsavel}_${item.id}`}
                  className={`list-item ${inscritoEstaAssinado(item) ? 'is-signed' : 'is-pending'}`}
                >
                  <div className="list-item-info">
                    <div className="list-item-name">{item.nome_completo || 'Sem nome'}</div>
                    <div className="list-item-secondary">
                      {item.order_code || 'Sem order_code'} {'\u2022'} {item.telefone_responsavel || item.tel_responsavel || 'Sem telefone'}
                    </div>
                    <div className={`list-status ${inscritoEstaAssinado(item) ? 'signed' : 'pending'}`}>
                      {inscritoEstaAssinado(item) ? 'Assinado' : 'Pendente de assinatura'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setError('');
                      prepararInscritoSelecionado(item);
                    }}
                    className="select-button"
                  >
                    Selecionar
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setEtapa('busca');
                setListaInscritos([]);
                setError('');
                setSuccess('');
              }}
              className="back-button"
            >
              Voltar
            </button>
          </div>
        )}

        {/* NOVA ETAPA: Termo já assinado */}
        {etapa === 'ja_assinado' && inscrito && (
          <div className="signed-term-section">
            <div className="signed-header">
              <div className="signed-icon">OK</div>
              <h2>{'Termo J\u00E1 Assinado'}</h2>
              <p>{'Este inscrito j\u00E1 possui termo de responsabilidade assinado'}</p>
            </div>

            <div className="inscrito-info-signed">
              <h3>Dados do Inscrito</h3>
              <div className="data-grid">
                <div className="data-item">
                  <strong>Nome:</strong> {inscrito.nome_completo || 'N/A'}
                </div>
                <div className="data-item">
                  <strong>Order Code:</strong> {inscrito.order_code || 'N/A'}
                </div>
                <div className="data-item">
                  <strong>{'Telefone do Respons\u00E1vel:'}</strong> {inscrito.telefone_responsavel || inscrito.tel_responsavel || 'N/A'}
                </div>
                <div className="data-item">
                  <strong>{'Respons\u00E1vel:'}</strong> {inscrito.nome_responsavel || inscrito.responsavel || 'N/A'}
                </div>
              </div>
            </div>

            <div className="pdf-actions">
              <h3>Termo de Responsabilidade</h3>
              <div className="pdf-buttons">
                <button 
                  onClick={visualizarPDF}
                  className="pdf-view-button"
                >
                  Visualizar Termo
                </button>
                <button 
                  onClick={baixarPDF}
                  className="pdf-download-button"
                >
                  Baixar PDF
                </button>
              </div>
            </div>

            <div className="action-buttons">
              {listaInscritos.length > 1 && (
                <button
                  onClick={voltarParaLista}
                  className="back-button"
                >
                  Voltar para lista
                </button>
              )}
              <button 
                onClick={voltarBusca}
                className="new-search-button"
              >
                Nova Busca
              </button>
            </div>
          </div>
        )}

        {/* Etapa 2: Contato de Emergência + Edição Opcional */}
        {etapa === 'contato_emergencia' && inscrito && (
          <div className="emergency-section">
            <div className="section-header">
              <h2>📞 Contato de Emergência (Obrigatório)</h2>
              <p>Em caso de não conseguirmos contato com o responsável:</p>
            </div>

            <div className="emergency-form">
              <div className="form-group">
                <label>Nome do Contato de Emergência: *</label>
                <input
                  type="text"
                  value={contatoEmergencia.nome}
                  onChange={(e) => setContatoEmergencia(prev => ({ ...prev, nome: e.target.value }))}
                  placeholder="Ex: Ana Lúcia"
                  className="form-input required"
                  required
                />
              </div>

              <div className="form-group">
                <label>Telefone do Contato de Emergência: *</label>
                <input
                  type="text"
                  value={contatoEmergencia.telefone}
                  onChange={(e) => setContatoEmergencia(prev => ({ ...prev, telefone: e.target.value }))}
                  placeholder="Ex: 67984049060"
                  className="form-input required"
                  required
                />
              </div>
            </div>

            {/* Seção de edição opcional */}
            <div className="edit-section">
              <div className="edit-header">
                <h3>✏️ Editar Dados (Opcional)</h3>
                <button 
                  onClick={() => setModoEdicao(!modoEdicao)}
                  className={`toggle-edit-button ${modoEdicao ? 'active' : ''}`}
                >
                  {modoEdicao ? 'Cancelar Edição' : 'Editar Dados Essenciais'}
                </button>
              </div>

              {modoEdicao && (
                <div className="simple-edit-form">
                  <div className="form-group">
                    <label>Nome do Filho(a):</label>
                    <input
                      type="text"
                      value={dadosEditados.nome_completo}
                      onChange={(e) => setDadosEditados(prev => ({ ...prev, nome_completo: e.target.value }))}
                      className="form-input"
                      placeholder={inscrito.nome_completo}
                    />
                  </div>

                  <div className="form-group">
                    <label>Nome do Responsável:</label>
                    <input
                      type="text"
                      value={dadosEditados.nome_responsavel}
                      onChange={(e) => setDadosEditados(prev => ({ ...prev, nome_responsavel: e.target.value }))}
                      className="form-input"
                      placeholder={inscrito.nome_responsavel || inscrito.responsavel}
                    />
                  </div>

                  <div className="form-group">
                    <label>Telefone do Responsável:</label>
                    <input
                      type="text"
                      value={dadosEditados.tel_responsavel}
                      onChange={(e) => setDadosEditados(prev => ({ ...prev, tel_responsavel: e.target.value }))}
                      className="form-input"
                      placeholder={inscrito.tel_responsavel}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* DADOS ATUAIS CORRIGIDOS - Mostrar dados do inscrito */}
            <div className="current-data">
              <h3>📋 Dados Atuais</h3>
              <div className="data-grid">
                <div className="data-item">
                  <strong>Nome do Inscrito:</strong> {modoEdicao ? (dadosEditados.nome_completo || inscrito.nome_completo) : inscrito.nome_completo}
                </div>
                <div className="data-item">
                  <strong>Order Code:</strong> {inscrito.order_code || 'N/A'}
                </div>
                <div className="data-item">
                  <strong>{'Telefone do Respons\u00E1vel:'}</strong> {modoEdicao ? (dadosEditados.tel_responsavel || inscrito.tel_responsavel) : inscrito.telefone_responsavel || inscrito.tel_responsavel}
                </div>
                <div className="data-item">
                  <strong>{'Respons\u00E1vel:'}</strong> {modoEdicao ? (dadosEditados.nome_responsavel || inscrito.nome_responsavel || inscrito.responsavel) : inscrito.nome_responsavel || inscrito.responsavel}
                </div>
                <div className="data-item">
                  <strong>Campus:</strong> {inscrito.campus || 'N/A'}
                </div>
                <div className="data-item">
                  <strong>Idade:</strong> {inscrito.idade || 'N/A'}
                </div>
              </div>
            </div>

            <div className="action-buttons">
              <button 
                onClick={gerarTermo}
                disabled={gerandoTermo || !contatoEmergencia.nome.trim() || !contatoEmergencia.telefone.trim()}
                className="generate-button"
              >
                {gerandoTermo ? 'Gerando Termo...' : '📄 Gerar Termo de Responsabilidade'}
              </button>
              <button 
                onClick={voltarBusca}
                className="back-button"
              >
                {listaInscritos.length > 1 ? 'Voltar para lista' : 'Voltar'}
              </button>
            </div>
          </div>
        )}

        {/* Etapa 3: Termo Gerado + Assinatura */}
        {etapa === 'termo_gerado' && inscrito && (
          <div className="term-section">
            <div className="term-header">
              <h2>Termo Gerado com Sucesso!</h2>
              <p>Revise o termo e assine abaixo:</p>
            </div>

            {/* Link para visualizar PDF */}
            {(inscrito.pdf_url || inscrito.pdf_path) && (
              <div className="pdf-section">
                <button 
                  onClick={visualizarPDF}
                  className="pdf-link"
                >
                  Visualizar Termo de Responsabilidade
                </button>
              </div>
            )}

            {/* Seção de assinatura */}
            {!inscrito.assinatura_realizada && (
              <div className="signature-section">
                <h3>Assinatura Digital</h3>
                <p>{'Faça sua assinatura no campo abaixo:'}</p>
                
                <div className="signature-container">
                  <SignatureCanvas
                    ref={sigCanvas}
                    canvasProps={{
                      width: 400,
                      height: 150,
                      className: 'signature-canvas'
                    }}
                  />
                </div>
                
                <div className="signature-buttons">
                  <button 
                    onClick={adicionarAssinatura}
                    disabled={loading}
                    className="sign-button"
                  >
                    {loading ? 'Processando...' : 'Assinar Termo'}
                  </button>
                  <button 
                    onClick={limparAssinatura}
                    className="clear-button"
                  >
                    Limpar
                  </button>
                </div>
              </div>
            )}

            {inscrito.assinatura_realizada && (
              <div className="signed-status">
                <p className="signed-message">Termo assinado com sucesso!</p>
              </div>
            )}

            <div className="action-buttons">
              {listaInscritos.length > 1 && (
                <button
                  onClick={voltarParaLista}
                  className="back-button"
                >
                  Voltar para lista
                </button>
              )}
              <button 
                onClick={voltarBusca}
                className="new-search-button"
              >
                Nova Busca
              </button>
            </div>
          </div>
        )}

        {/* Mensagens */}
        {error && <div className="message error">{error}</div>}
        {success && <div className="message success">{success}</div>}
      </div>
    </div>
  );
}

export default App;
