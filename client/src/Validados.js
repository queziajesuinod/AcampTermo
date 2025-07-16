// Validados.js - Versão com lista/tabela em vez de cards
import React, { useState, useEffect } from 'react';
import './Validados.css';

function Validados() {
  // Estados para validados
  const [validados, setValidados] = useState([]);
  const [loadingValidados, setLoadingValidados] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Estados para filtros
  const [filtros, setFiltros] = useState({
    busca: '',
    campus: '',
    data_inicio: '',
    data_fim: ''
  });
  
  // Estados para paginação
  const [paginacao, setPaginacao] = useState({
    page: 1,
    limit: 50, // Aumentado para 50 itens por página na lista
    total: 0,
    totalPages: 0
  });
  
  // Estados para estatísticas
  const [estatisticas, setEstatisticas] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Função para buscar validados
  const buscarValidados = async (page = 1) => {
    try {
      setLoadingValidados(true);
      setError('');
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: paginacao.limit.toString(),
        ...filtros
      });
      
      // Remover parâmetros vazios
      Object.keys(filtros).forEach(key => {
        if (!filtros[key]) {
          params.delete(key);
        }
      });
      
      console.log('🔍 Buscando validados com parâmetros:', params.toString());
      
      const response = await fetch(`http://localhost:3001/api/validados?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setValidados(data.data);
        setPaginacao(data.pagination);
        console.log(`✅ ${data.data.length} validados carregados`);
      } else {
        setError(data.message || 'Erro ao buscar validados');
      }
      
    } catch (error) {
      console.error('❌ Erro ao buscar validados:', error);
      setError('Erro ao conectar com o servidor');
    } finally {
      setLoadingValidados(false);
    }
  };

  // Função para buscar estatísticas
  const buscarEstatisticas = async () => {
    try {
      setLoadingStats(true);
      
      const response = await fetch('http://localhost:3001/api/validados/stats');
      const data = await response.json();
      
      if (data.success) {
        setEstatisticas(data.data);
        console.log('📊 Estatísticas carregadas:', data.data);
      } else {
        console.error('❌ Erro ao buscar estatísticas:', data.message);
      }
      
    } catch (error) {
      console.error('❌ Erro ao buscar estatísticas:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  // Efeito para carregar dados iniciais
  useEffect(() => {
    buscarValidados();
    buscarEstatisticas();
  }, []);

  // Efeito para aplicar filtros com debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      buscarValidados(1);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [filtros]);

  // 🔧 Função corrigida para visualizar PDF
  const visualizarPDF = (pdfUrl) => {
    try {
      // Garantir que a URL está correta
      let url = pdfUrl;
      if (!url.startsWith('http')) {
        url = `https://termoacamp.aleftec.com.br${pdfUrl}`;
      }
      
      console.log('🔗 Abrindo PDF:', url);
      window.open(url, '_blank', 'noopener,noreferrer');
      
    } catch (error) {
      console.error('❌ Erro ao visualizar PDF:', error);
      setError('Erro ao abrir PDF');
    }
  };

  // 🔧 Função corrigida para baixar PDF
  const baixarPDF = (pdfUrl, nomeArquivo) => {
    try {
      // Garantir que a URL está correta
      let url = pdfUrl;
      if (!url.startsWith('http')) {
        url = `https://termoacamp.aleftec.com.br${pdfUrl}`;
      }
      
      console.log('📥 Baixando PDF:', url);
      
      // Criar link temporário para download
      const link = document.createElement('a');
      link.href = url;
      link.download = nomeArquivo || 'termo.pdf';
      link.target = '_blank';
      
      // Adicionar ao DOM temporariamente
      document.body.appendChild(link);
      link.click();
      
      // Remover do DOM
      setTimeout(() => {
        document.body.removeChild(link);
      }, 100);
      
      setSuccess('Download iniciado com sucesso!');
      setTimeout(() => setSuccess(''), 3000);
      
    } catch (error) {
      console.error('❌ Erro ao baixar PDF:', error);
      setError('Erro ao baixar PDF');
    }
  };

  // Função para mudar página
  const mudarPagina = (novaPagina) => {
    if (novaPagina >= 1 && novaPagina <= paginacao.totalPages) {
      buscarValidados(novaPagina);
    }
  };

  // Função para formatar data
  const formatarData = (dataString) => {
    const data = new Date(dataString);
    return data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Função para formatar CPF
  const formatarCPF = (cpf) => {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  // Função para limpar filtros
  const limparFiltros = () => {
    setFiltros({
      busca: '',
      campus: '',
      data_inicio: '',
      data_fim: ''
    });
  };

  return (
    <div className="validados-container">
      {/* Header */}
      <header className="validados-header">
        <div className="header-content">
          <h1>✅ Termos de Responsabilidade Validados</h1>
          <p className="header-subtitle">
            Visualize e gerencie todos os termos de responsabilidade assinados
          </p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => window.location.href = '/'}
            className="btn-secondary"
          >
            📝 Novo Termo
          </button>
        </div>
      </header>

      {/* Mensagens */}
      {error && (
        <div className="message error-message">
          ❌ {error}
        </div>
      )}
      
      {success && (
        <div className="message success-message">
          ✅ {success}
        </div>
      )}

      {/* Estatísticas */}
      {estatisticas && (
        <div className="stats-section">
          <h2>📊 Estatísticas Gerais</h2>
          <div className="stats-grid">
            <div className="stat-card primary">
              <div className="stat-icon">📋</div>
              <div className="stat-content">
                <div className="stat-number">{estatisticas.geral.total_assinados}</div>
                <div className="stat-label">Total de Termos Assinados</div>
              </div>
            </div>
            
            <div className="stat-card secondary">
              <div className="stat-icon">🏫</div>
              <div className="stat-content">
                <div className="stat-number">{estatisticas.geral.total_campus}</div>
                <div className="stat-label">Campus Diferentes</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="filtros-section">
        <h2>🔍 Filtros de Busca</h2>
        <div className="filtros-grid">
          <div className="filtro-group">
            <label htmlFor="busca">🔍 Buscar por Nome ou CPF:</label>
            <input
              id="busca"
              type="text"
              value={filtros.busca}
              onChange={(e) => setFiltros(prev => ({ ...prev, busca: e.target.value }))}
              placeholder="Digite nome ou CPF..."
              className="filtro-input"
            />
          </div>
          
          <div className="filtro-group">
            <label htmlFor="campus">🏫 Campus:</label>
            <input
              id="campus"
              type="text"
              value={filtros.campus}
              onChange={(e) => setFiltros(prev => ({ ...prev, campus: e.target.value }))}
              placeholder="Digite o campus..."
              className="filtro-input"
            />
          </div>
          

        </div>
        
        <div className="filtros-actions">
          <button 
            onClick={limparFiltros}
            className="btn-clear"
          >
            🗑️ Limpar Filtros
          </button>
          <button 
            onClick={() => buscarValidados(1)}
            className="btn-search"
          >
            🔍 Buscar
          </button>
        </div>
      </div>

      {/* Lista de validados */}
      <div className="validados-section">
        <div className="section-header">
          <h2>📋 Lista de Termos Validados</h2>
          <div className="results-info">
            {loadingValidados ? (
              <span>Carregando...</span>
            ) : (
              <span>
                Mostrando {validados.length} de {paginacao.total} termos
              </span>
            )}
          </div>
        </div>

        {loadingValidados ? (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Carregando termos validados...</p>
          </div>
        ) : (
          <>
            {validados.length > 0 ? (
              <div className="table-container">
                <table className="validados-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>CPF</th>
                      <th>Responsável</th>
                      <th>Campus</th>
                      <th>Telefone</th>
                      <th>Email</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validados.map((validado) => (
                      <tr key={validado.id}>
                        <td className="nome-cell">
                          <div className="nome-info">
                            <span className="nome-principal">{validado.nome_completo}</span>
                            <span className="status-badge">✅ Assinado</span>
                          </div>
                        </td>
                        <td className="cpf-cell">{formatarCPF(validado.documento)}</td>
                        <td>{validado.responsavel || 'N/A'}</td>
                        <td>{validado.campus || 'N/A'}</td>
                        <td>{validado.tel_responsavel || 'N/A'}</td>
                        <td className="email-cell">{validado.email || 'N/A'}</td>
                        <td className="acoes-cell">
                          <div className="acoes-buttons">
                            <button 
                              onClick={() => visualizarPDF(validado.pdf_url)}
                              className="btn-view"
                              title="Visualizar PDF"
                            >
                              👁️
                            </button>
                            <button 
                              onClick={() => baixarPDF(validado.pdf_url, `termo_${formatarCPF(validado.documento)}.pdf`)}
                              className="btn-download"
                              title="Baixar PDF"
                            >
                              📥
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="no-results">
                <div className="no-results-icon">📭</div>
                <h3>Nenhum termo encontrado</h3>
                <p>Não foram encontrados termos validados com os filtros aplicados.</p>
                <button onClick={limparFiltros} className="btn-primary">
                  🗑️ Limpar Filtros
                </button>
              </div>
            )}

            {/* Paginação */}
            {paginacao.totalPages > 1 && (
              <div className="paginacao">
                <button 
                  onClick={() => mudarPagina(paginacao.page - 1)}
                  disabled={paginacao.page === 1}
                  className="btn-pagination"
                >
                  ⬅️ Anterior
                </button>
                
                <div className="pagination-info">
                  <span>
                    Página {paginacao.page} de {paginacao.totalPages}
                  </span>
                  <span className="pagination-details">
                    ({paginacao.total} termos no total)
                  </span>
                </div>
                
                <button 
                  onClick={() => mudarPagina(paginacao.page + 1)}
                  disabled={paginacao.page === paginacao.totalPages}
                  className="btn-pagination"
                >
                  Próxima ➡️
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Validados;

