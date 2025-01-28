const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const which = require('which'); // For cross-platform command resolution

// Global server tracker
const activeServers = new Map();

async function loadConfig() {
  const configPath = path.join(__dirname, 'deepseek_desktop_config.json');
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Config load failed:', error);
    process.exit(1);
  }
}

async function resolveCommandPath(command) {
  try {
    return await which(command);
  } catch {
    return command; // Return original if not in PATH
  }
}

async function startMCPServers() {
  const config = await loadConfig();
  
  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    try {
      const fullCommand = await resolveCommandPath(serverConfig.command);
      const sanitizedArgs = serverConfig.args.map(arg => 
        arg.replace(/\$([A-Z_]+)/g, (_, varName) => process.env[varName] || '')
      );

      const serverProcess = spawn(`"${fullCommand}"`, sanitizedArgs, {
        shell: true,
        windowsVerbatimArguments: true
      });

      activeServers.set(serverName, {
        process: serverProcess,
        config: serverConfig,
        status: 'starting'
      });

      serverProcess.stdout.on('data', (data) => {
        console.log(`[${serverName}] STDOUT: ${data}`);
        if(data.toString().includes('Server started')) {
          activeServers.get(serverName).status = 'running';
        }
      });

      serverProcess.stderr.on('data', (data) => {
        console.error(`[${serverName}] ERROR: ${data}`);
        activeServers.get(serverName).status = 'error';
      });

      serverProcess.on('exit', (code) => {
        console.log(`[${serverName}] Exited with code ${code}`);
        activeServers.get(serverName).status = code === 0 ? 'stopped' : 'crashed';
      });

      serverProcess.on('error', (err) => {
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
}

function cleanupServers() {
  activeServers.forEach((server, name) => {
    try {
      if(server.process) {
        console.log(`Stopping ${name} (PID: ${server.process.pid})`);
        server.process.kill('SIGTERM');
      }
    } catch (error) {
      console.error(`Error stopping ${name}:`, error);
    }
  });
}

// Modified IPC handler for detailed status
ipcMain.handle('get-server-status', () => {
  return Array.from(activeServers.entries()).map(([name, info]) => ({
    name,
    status: info.status,
    command: info.config.command,
    args: info.config.args,
    pid: info.process?.pid,
    error: info.error
  }));
});

// Window creation and app lifecycle remains similar
// ... (keep previous createWindow and app lifecycle code)

// Window management
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'deepseek-logo.png')
  });

  mainWindow.loadURL('https://chat.deepseek.com/');
}

// Application lifecycle
// Required dependencies
app.whenReady().then(async () => {
  await startMCPServers();
  createWindow();
});

app.on('window-all-closed', () => {
  cleanupServers();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
