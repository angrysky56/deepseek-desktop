  const { app, BrowserWindow, ipcMain } = require('electron');
  const fs = require('fs/promises');
  const path = require('path');
  const { spawn } = require('child_process');
  const which = require('which');

  async function loadConfig() {
    const configPath = path.join(__dirname, 'deepseek_desktop_config.json');
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Config load failed:', error);
      dialog.showErrorBox('Configuration Error', `Failed to load config: ${error.message}`);
      return {}; // Graceful degradation
    }
  }

  // Global server tracker
  const activeServers = new Map();
    async function resolveCommandPath(command) {
      if (path.isAbsolute(command)) {
        // Handle Windows paths with proper escaping for Node.js
        const normalizedPath = path.normalize(command);
        return process.platform === 'win32' ? 
          `"${normalizedPath}"` : normalizedPath;
      }
  
      try {
        const resolvedPath = await which(command);
        return process.platform === 'win32' ? 
          `"${resolvedPath}"` : resolvedPath;
      } catch {
        return command;
      }
    }
      async function startMCPServers() {
        const config = await loadConfig();

        for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
          try {
            const fullCommand = await resolveCommandPath(serverConfig.command);
            const sanitizedArgs = serverConfig.args.map(arg => {
              const processed = arg.replace(/\$([A-Z_]+)/g, (_, varName) => process.env[varName] || '');
              return process.platform === 'win32' && /\s/.test(processed) ? 
                `"${processed}"` : processed;
            });

            const serverProcess = spawn(fullCommand, sanitizedArgs, {
              shell: true,
              windowsVerbatimArguments: true,
              cwd: __dirname,
              env: {
                ...process.env,
                ...(serverConfig.env || {})
              }
            });

            activeServers.set(serverName, {
              process: serverProcess,
              config: serverConfig,
              status: 'starting'
            });

            serverProcess.stdout.on('data', (data) => {
              console.log(`[${serverName}] ${data}`);
              if (data.toString().includes('Server started') || 
                  data.toString().includes('running on stdio') ||
                  data.toString().includes('Server running')) {
                activeServers.get(serverName).status = 'running';
              }
            });

            serverProcess.stderr.on('data', (data) => {
              if (data.toString().includes('Error') || data.toString().includes('ERROR')) {
                console.error(`[${serverName}] ERROR: ${data}`);
                activeServers.get(serverName).status = 'error';
              } else {
                console.log(`[${serverName}] ${data}`);
              }
            });

            serverProcess.on('exit', (code) => {
              clearTimeout(startupTimer);
              console.log(`[${serverName}] Exited with code ${code}`);
              activeServers.get(serverName).status = code === 0 ? 'stopped' : 'crashed';
            });

            serverProcess.on('error', (err) => {
              clearTimeout(startupTimer);
              console.error(`[${serverName}] Process error:`, err);
              activeServers.get(serverName).status = 'failed';
            });
          } catch (error) {
            console.error(`[${serverName}] Startup failed:`, error);
            activeServers.set(serverName, {
              error: error.message,
              status: 'failed'
            });
          }
        }
    }    function cleanupServers() {
  activeServers.forEach((server, name) => {
    try {
      if (server.process) {
        console.log(`Stopping ${name} (PID: ${server.process.pid})`);
        server.process.kill('SIGTERM');
      }
    } catch (error) {
      console.error(`Error stopping ${name}:`, error);
    }
  });
}

ipcMain.handle('get-server-status', () => {
  return Array.from(activeServers.entries()).map(([name, info]) => ({
    name,
    status: info.status,
    command: info.config.command,
    args: info.config.args,
    pid: info.process?.pid,
    uptime: info.process ? Date.now() - info.process.startTime : 0,
    memoryUsage: info.process?.memoryUsage?.(),
    error: info.error
  }));
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,     // Security: Disabled
      contextIsolation: true,     // Security: Enabled
      sandbox: true,              // Security: Enabled
      webSecurity: true           // Security: Enabled
    },
    icon: path.join(__dirname, 'deepseek-logo.png')
  });

  mainWindow.loadURL('https://chat.deepseek.com/');
}

app.whenReady().then(async () => {
  try {
    await startMCPServers();
    createWindow();
  } catch (error) {
    console.error('Startup error:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  cleanupServers();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
