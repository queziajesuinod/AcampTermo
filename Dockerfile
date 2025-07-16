# ==========================================
# DOCKERFILE CORRIGIDO E OTIMIZADO
# Sistema de Termo de Responsabilidade
# ==========================================

# 🔧 CORREÇÃO 1: Usar versão específica em vez de 'latest'
FROM node:18-alpine AS base

# 🔧 CORREÇÃO 2: Instalar dependências do sistema necessárias
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

# 🔧 CORREÇÃO 3: Criar usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# ==========================================
# STAGE 1: Preparação e Clone
# ==========================================
FROM base AS clone

WORKDIR /app

# 🔧 CORREÇÃO 4: Clone mais seguro com verificação
RUN git clone https://github.com/queziajesuinod/termo-acamp.git . && \
    ls -la && \
    echo "📁 Conteúdo clonado:" && \
    find . -name "package.json" -type f

# ==========================================
# STAGE 2: Build do Frontend (se necessário)
# ==========================================
FROM clone AS frontend-build

# 🔧 CORREÇÃO 5: Verificar se existe client e fazer build correto
WORKDIR /app

# Verificar estrutura do projeto
RUN echo "🔍 Verificando estrutura do projeto:" && \
    ls -la && \
    if [ -d "client" ]; then \
        echo "📁 Pasta client encontrada"; \
        cd client && \
        if [ -f "package.json" ]; then \
            echo "📦 Instalando dependências do frontend..."; \
            npm ci --only=production; \
            echo "🏗️ Fazendo build do frontend..."; \
            npm run build; \
        fi; \
    else \
        echo "⚠️ Pasta client não encontrada"; \
    fi

# ==========================================
# STAGE 3: Preparação do Backend
# ==========================================
FROM clone AS backend-setup

WORKDIR /app

# 🔧 CORREÇÃO 6: Instalar dependências do backend de forma otimizada
RUN if [ -f "package.json" ]; then \
        echo "📦 Instalando dependências da raiz..."; \
        npm ci --only=production; \
    fi

# Se existe pasta server, instalar dependências dela também
RUN if [ -d "server" ] && [ -f "server/package.json" ]; then \
        echo "📦 Instalando dependências do servidor..."; \
        cd server && npm ci --only=production; \
    fi

# ==========================================
# STAGE 4: Produção Final
# ==========================================
FROM base AS production

WORKDIR /app

# Copiar código do backend
COPY --from=backend-setup /app .

# Copiar frontend buildado (se existir)
COPY --from=frontend-build /app/client/build ./server/public/client 2>/dev/null || echo "⚠️ Frontend build não encontrado"

# 🔧 CORREÇÃO 7: Criar diretórios necessários
RUN mkdir -p ./server/public/assinados && \
    mkdir -p ./server/logs && \
    mkdir -p ./uploads

# 🔧 CORREÇÃO 8: Configurar variáveis de ambiente de forma segura
# NÃO hardcodar credenciais - usar variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3001

# 🔧 CORREÇÃO 9: Definir permissões corretas
RUN chown -R nodejs:nodejs /app && \
    chmod -R 755 /app

# 🔧 CORREÇÃO 10: Mudar para usuário não-root
USER nodejs

# Expor porta
EXPOSE 3001

# 🔧 CORREÇÃO 11: Adicionar healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# 🔧 CORREÇÃO 12: Comando de inicialização mais robusto
WORKDIR /app/server
CMD ["node", "index.js"]

