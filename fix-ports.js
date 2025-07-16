#!/usr/bin/env node

// Script JavaScript para limpeza de portas - Cross-platform
const { exec, spawn } = require('child_process');
const os = require('os');

console.log('🔧 ACAMP TERMO - Limpeza de Portas');
console.log('==================================');

// Função para executar comando e retornar promise
function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: error.message, stdout: '', stderr });
      } else {
        resolve({ error: null, stdout, stderr });
      }
    });
  });
}

// Função para matar processo em uma porta específica
async function killPort(port) {
  console.log(`🔍 Verificando porta ${port}...`);
  
  let command;
  const platform = os.platform();
  
  // Comando diferente para cada sistema operacional
  if (platform === 'win32') {
    command = `netstat -ano | findstr :${port}`;
  } else {
    command = `lsof -ti:${port} 2>/dev/null || echo ""`;
  }
  
  try {
    const result = await execCommand(command);
    
    if (platform === 'win32') {
      // Windows: extrair PID do netstat
      const lines = result.stdout.split('\n');
      const pids = [];
      
      for (const line of lines) {
        if (line.includes(`:${port}`)) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && !isNaN(pid)) {
            pids.push(pid);
          }
        }
      }
      
      if (pids.length > 0) {
        console.log(`⚠️ Processo(s) encontrado(s) na porta ${port} (PID: ${pids.join(', ')})`);
        
        for (const pid of pids) {
          console.log(`🔪 Matando processo ${pid}...`);
          await execCommand(`taskkill /PID ${pid} /F`);
        }
        
        // Verificar se foi morto
        await new Promise(resolve => setTimeout(resolve, 2000));
        const checkResult = await execCommand(command);
        
        if (!checkResult.stdout.includes(`:${port}`)) {
          console.log(`✅ Porta ${port} liberada com sucesso!`);
        } else {
          console.log(`❌ Falha ao liberar porta ${port}`);
        }
      } else {
        console.log(`✅ Porta ${port} já está livre`);
      }
    } else {
      // Unix/Linux/macOS
      const pid = result.stdout.trim();
      
      if (pid && pid !== '' && !isNaN(pid)) {
        console.log(`⚠️ Processo encontrado na porta ${port} (PID: ${pid})`);
        console.log(`🔪 Matando processo...`);
        
        // Tentar kill normal primeiro
        await execCommand(`kill ${pid}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verificar se ainda existe
        const checkResult = await execCommand(`kill -0 ${pid} 2>/dev/null`);
        if (!checkResult.error) {
          console.log(`🔨 Forçando encerramento...`);
          await execCommand(`kill -9 ${pid}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verificação final
        const finalCheck = await execCommand(`lsof -ti:${port} 2>/dev/null || echo ""`);
        if (!finalCheck.stdout.trim()) {
          console.log(`✅ Porta ${port} liberada com sucesso!`);
        } else {
          console.log(`❌ Falha ao liberar porta ${port}`);
        }
      } else {
        console.log(`✅ Porta ${port} já está livre`);
      }
    }
  } catch (error) {
    console.log(`❌ Erro ao verificar porta ${port}: ${error.message}`);
  }
}

// Função para limpar processos Node.js órfãos
async function cleanupNodeProcesses() {
  console.log('');
  console.log('🧹 Limpando processos Node.js órfãos...');
  
  const platform = os.platform();
  const processes = ['react-scripts', 'nodemon', 'webpack', 'babel'];
  
  for (const processName of processes) {
    try {
      let command;
      
      if (platform === 'win32') {
        command = `taskkill /F /IM node.exe /FI "WINDOWTITLE eq ${processName}*" 2>nul`;
      } else {
        command = `pkill -f "${processName}" 2>/dev/null || true`;
      }
      
      await execCommand(command);
    } catch (error) {
      // Ignorar erros de limpeza
    }
  }
}

// Função principal
async function main() {
  try {
    // Verificar se Node.js está disponível
    console.log('🔍 Verificando ambiente...');
    
    // Matar processos nas portas 3000 e 3001
    await killPort(3000);
    await killPort(3001);
    
    // Limpar processos órfãos
    await cleanupNodeProcesses();
    
    console.log('');
    console.log('⏳ Aguardando 3 segundos para garantir limpeza...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Verificação final
    console.log('');
    console.log('🎯 Verificação final das portas:');
    
    const platform = os.platform();
    
    for (const port of [3000, 3001]) {
      let command;
      
      if (platform === 'win32') {
        command = `netstat -ano | findstr :${port}`;
      } else {
        command = `lsof -ti:${port} 2>/dev/null || echo "LIVRE"`;
      }
      
      const result = await execCommand(command);
      
      if (platform === 'win32') {
        const status = result.stdout.includes(`:${port}`) ? 'OCUPADA' : 'LIVRE';
        console.log(`Porta ${port}: ${status}`);
      } else {
        const status = result.stdout.trim() || 'LIVRE';
        console.log(`Porta ${port}: ${status}`);
      }
    }
    
    console.log('');
    console.log('✨ Limpeza concluída!');
    console.log('');
    console.log('📋 Próximos passos:');
    console.log('1. npm run dev        # Rodar sistema completo');
    console.log('2. npm run start:server # Apenas servidor');
    console.log('3. npm run start:client # Apenas cliente');
    console.log('');
    console.log('🔗 URLs após iniciar:');
    console.log('- Servidor: http://localhost:3001');
    console.log('- Cliente:  http://localhost:3000');
    console.log('');
    
  } catch (error) {
    console.error('❌ Erro durante limpeza:', error.message);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main();
}

module.exports = { killPort, cleanupNodeProcesses };

