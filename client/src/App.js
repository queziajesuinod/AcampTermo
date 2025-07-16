// App.jsx FINAL AJUSTADO - Validação CPF + Fluxo para termos já assinados
import React, { useState, useRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import Validados from './Validados';
import './App.css';

function App() {
  const [cpf, setCpf] = useState('');
  const [inscrito, setInscrito] = useState(null);
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
    responsavel: '',
    tel_responsavel: ''
  });
  
  // Estados de controle
  const [etapa, setEtapa] = useState('busca'); // 'busca', 'contato_emergencia', 'termo_gerado', 'ja_assinado'
  const [gerandoTermo, setGerandoTermo] = useState(false);

  // 🆕 Estado para controle de rota
  const [rotaAtual, setRotaAtual] = useState('home');
  
  const sigCanvas = useRef({});

   // 🆕 Efeito para detectar rota na URL
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

  // 🆕 Função para navegar entre rotas
  const navegarPara = (rota) => {
    if (rota === 'validados') {
      window.history.pushState({}, '', '/validados');
      setRotaAtual('validados');
    } else {
      window.history.pushState({}, '', '/');
      setRotaAtual('home');
    }
  };

  // Função para validar CPF
  const validarCPF = (cpf) => {
    // Remove caracteres não numéricos
    const cpfLimpo = cpf.replace(/\D/g, '');
    
    // Verifica se tem 11 dígitos
    if (cpfLimpo.length !== 11) {
      return false;
    }
    
    // Verifica se não são todos os dígitos iguais
    if (/^(\d)\1{10}$/.test(cpfLimpo)) {
      return false;
    }
    
    return true;
  };

  // Função para formatar CPF durante digitação
  const formatarCPF = (valor) => {
    const cpfLimpo = valor.replace(/\D/g, '');
    
    if (cpfLimpo.length <= 11) {
      return cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    
    return valor;
  };

  // Função para lidar com mudança no input CPF
  const handleCPFChange = (e) => {
    const valor = e.target.value;
    const cpfFormatado = formatarCPF(valor);
    setCpf(cpfFormatado);
  };

  // Função para buscar inscrito
  const buscarInscrito = async () => {
    const cpfLimpo = cpf.replace(/\D/g, '');
    
    // Validar CPF
    if (!validarCPF(cpfLimpo)) {
      setError('Por favor, digite um CPF válido com 11 dígitos');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setInscrito(null);
    setEtapa('busca');

    try {
      const response = await fetch(`https://termoacamp.aleftec.com.br/api/inscrito/${cpfLimpo}`);
      const data = await response.json();

      if (response.ok) {
        setInscrito(data);
        
        // 🆕 VERIFICAR SE JÁ FOI ASSINADO
        if (data.assinatura_realizada && data.pdf_path) {
          console.log('📋 Termo já assinado, indo para tela de visualização');
          setEtapa('ja_assinado');
          setSuccess('Termo já foi assinado anteriormente!');
        } else {
          // Fluxo normal para termos não assinados
          setDadosEditados({
            nome_completo: data.nome_completo,
            responsavel: data.responsavel,
            tel_responsavel: data.tel_responsavel
          });
          
          // Pré-preencher contato de emergência se já existir
          setContatoEmergencia({
            nome: data.contato_nome || '',
            telefone: data.contato_telefone || ''
          });
          
          setEtapa('contato_emergencia');
          setSuccess('Inscrito encontrado! Preencha o contato de emergência.');
        }
      } else {
        setError(data.error || 'Erro ao buscar inscrito');
      }
    } catch (err) {
      setError('Erro de conexão com o servidor');
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  // Função para gerar termo com contato de emergência
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
      const response = await fetch('https://termoacamp.aleftec.com.br/api/gerar-termo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cpf: inscrito.documento,
          contato_nome: contatoEmergencia.nome,
          contato_telefone: contatoEmergencia.telefone,
          dados_editados: modoEdicao ? dadosEditados : null
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setInscrito(data);
        setEtapa('termo_gerado');
        setModoEdicao(false);
        setSuccess('Termo gerado com sucesso!');
      } else {
        setError(data.error || 'Erro ao gerar termo');
      }
    } catch (err) {
      setError('Erro de conexão com o servidor');
      console.error('Erro:', err);
    } finally {
      setGerandoTermo(false);
    }
  };

  // Função para adicionar assinatura
  const adicionarAssinatura = async () => {
    if (!inscrito) {
      setError('Nenhum inscrito selecionado');
      return;
    }

    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      setError('Por favor, faça sua assinatura antes de continuar');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const assinaturaDataURL = sigCanvas.current.toDataURL();
      
      const response = await fetch('https://termoacamp.aleftec.com.br/api/atualizar-assinatura', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cpf: inscrito.documento,
          assinatura: assinaturaDataURL,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess('Assinatura adicionada com sucesso!');
        setInscrito(prev => ({ ...prev, assinatura_realizada: true }));
        sigCanvas.current.clear();
      } else {
        setError(data.error || 'Erro ao adicionar assinatura');
      }
    } catch (err) {
      setError('Erro de conexão com o servidor');
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  // Função para limpar assinatura
  const limparAssinatura = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear();
    }
  };

  // Função para voltar à busca
  const voltarBusca = () => {
    setEtapa('busca');
    setInscrito(null);
    setCpf('');
    setContatoEmergencia({ nome: '', telefone: '' });
    setModoEdicao(false);
    setError('');
    setSuccess('');
  };

  // Função para baixar PDF
  const baixarPDF = () => {
    if (inscrito && inscrito.pdf_url) {
      const link = document.createElement('a');
      link.href = `https://termoacamp.aleftec.com.br${inscrito.pdf_url}`;
      link.download = `termo_${inscrito.documento}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // 🆕 Renderizar baseado na rota
  if (rotaAtual === 'validados') {
    return <Validados />;
  }

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>Sistema de Termo de Responsabilidade</h1>
          <p>ACAMP RELEVANTE JUNIORS 2025</p>
        </header>

        {/* Etapa 1: Busca de CPF com validação */}
        {etapa === 'busca' && (
          <div className="search-section">
            <div className="input-group">
              <input
                type="text"
                value={cpf}
                onChange={handleCPFChange}
                placeholder="Digite o CPF do inscrito (000.000.000-00)"
                className="cpf-input"
                disabled={loading}
                maxLength={14}
              />
              <button 
                onClick={buscarInscrito} 
                disabled={loading || !validarCPF(cpf.replace(/\D/g, ''))}
                className="search-button"
              >
                {loading ? 'Buscando...' : 'Buscar Inscrito'}
              </button>
            </div>
            {cpf && !validarCPF(cpf.replace(/\D/g, '')) && (
              <div className="cpf-validation">
                <small className="validation-message">CPF deve ter 11 dígitos</small>
              </div>
            )}
          </div>
        )}

        {/* 🆕 NOVA ETAPA: Termo já assinado */}
        {etapa === 'ja_assinado' && inscrito && (
          <div className="signed-term-section">
            <div className="signed-header">
              <div className="signed-icon">✅</div>
              <h2>Termo Já Assinado</h2>
              <p>Este CPF já possui termo de responsabilidade assinado</p>
            </div>

            <div className="inscrito-info-signed">
              <h3>📋 Dados do Inscrito</h3>
              <div className="data-grid">
                <div className="data-item">
                  <strong>Nome:</strong> {inscrito.nome_completo}
                </div>
                <div className="data-item">
                  <strong>CPF:</strong> {inscrito.documento}
                </div>
                <div className="data-item">
                  <strong>Responsável:</strong> {inscrito.responsavel}
                </div>
                <div className="data-item">
                  <strong>Telefone do Responsável:</strong> {inscrito.tel_responsavel}
                </div>
              </div>
            </div>

            <div className="pdf-actions">
              <h3>📄 Termo de Responsabilidade</h3>
              <div className="pdf-buttons">
                <a 
                  href={`https://termoacamp.aleftec.com.br${inscrito.pdf_url || inscrito.pdf_path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pdf-view-button"
                >
                  👁️ Visualizar Termo
                </a>
                <button 
                  onClick={baixarPDF}
                  className="pdf-download-button"
                >
                  📥 Baixar PDF
                </button>
              </div>
            </div>

            <div className="action-buttons">
              <button 
                onClick={voltarBusca}
                className="new-search-button"
              >
                🔍 Nova Busca
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
                    />
                  </div>

                  <div className="form-group">
                    <label>Nome do Responsável:</label>
                    <input
                      type="text"
                      value={dadosEditados.responsavel}
                      onChange={(e) => setDadosEditados(prev => ({ ...prev, responsavel: e.target.value }))}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>Telefone do Responsável:</label>
                    <input
                      type="text"
                      value={dadosEditados.tel_responsavel}
                      onChange={(e) => setDadosEditados(prev => ({ ...prev, tel_responsavel: e.target.value }))}
                      className="form-input"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Dados atuais para referência */}
            <div className="current-data">
              <h3>📋 Dados Atuais</h3>
              <div className="data-grid">
                <div className="data-item">
                  <strong>Nome do Inscrito:</strong> {modoEdicao ? dadosEditados.nome_completo : inscrito.nome_completo}
                </div>
                <div className="data-item">
                  <strong>CPF:</strong> {inscrito.documento}
                </div>
                <div className="data-item">
                  <strong>Responsável:</strong> {modoEdicao ? dadosEditados.responsavel : inscrito.responsavel}
                </div>
                <div className="data-item">
                  <strong>Telefone do Responsável:</strong> {modoEdicao ? dadosEditados.tel_responsavel : inscrito.tel_responsavel}
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
                ← Voltar
              </button>
            </div>
          </div>
        )}

        {/* Etapa 3: Termo Gerado + Assinatura */}
        {etapa === 'termo_gerado' && inscrito && (
          <div className="term-section">
            <div className="term-header">
              <h2>✅ Termo Gerado com Sucesso!</h2>
              <p>Revise o documento e assine abaixo:</p>
            </div>

            {/* Link para visualizar PDF */}
            {inscrito.pdf_url && (
              <div className="pdf-section">
                <a 
                  href={`https://termoacamp.aleftec.com.br${inscrito.pdf_url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pdf-link"
                >
                  📄 Visualizar Termo de Responsabilidade
                </a>
              </div>
            )}

            {/* Seção de assinatura */}
            {!inscrito.assinatura_realizada && (
              <div className="signature-section">
                <h3>✍️ Assinatura Digital</h3>
                <p>Faça sua assinatura no campo abaixo:</p>
                
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
                    {loading ? 'Processando...' : '✍️ Assinar Termo'}
                  </button>
                  <button 
                    onClick={limparAssinatura}
                    className="clear-button"
                  >
                    🗑️ Limpar
                  </button>
                </div>
              </div>
            )}

            {inscrito.assinatura_realizada && (
              <div className="signed-status">
                <p className="signed-message">✅ Termo assinado com sucesso!</p>
              </div>
            )}

            <div className="action-buttons">
              <button 
                onClick={voltarBusca}
                className="new-search-button"
              >
                🔍 Nova Busca Termo
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

