// electron/main.ts
import { app, BrowserWindow, globalShortcut } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';
import * as isDev from 'electron-is-dev';

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow: BrowserWindow | null;
let nextServerProcess: any = null;

async function createWindow() {
  console.log('Creating Electron window...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // In development, use the live Next.js server
  if (isDev) {
    console.log('Development mode - using Next.js dev server');
    await waitForNextDevServer('http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, use the built Next.js app
    console.log('Production mode - using built Next.js app');
    const nextPath = path.join(__dirname, '../../.next/server/pages/index.html');
    mainWindow.loadFile(nextPath);
  }

  mainWindow.on('closed', () => {
    console.log('Main window closed.');
    mainWindow = null;
  });
}

// Helper function to wait for Next.js dev server
function waitForNextDevServer(url: string): Promise<void> {
  return new Promise((resolve) => {
    const tryConnection = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          console.log('Waiting for Next.js dev server...');
          setTimeout(tryConnection, 1000);
        });
    };
    tryConnection();
  });
}

app.whenReady().then(async () => {
  console.log('App is ready, creating window...');
  
  if (isDev) {
    // Start Next.js dev server in development
    nextServerProcess = spawn('npm', ['run', 'next:dev'], {
      shell: true,
      stdio: 'inherit',
    });
  }
  
  await createWindow();

  // Register a global hotkey
  const hotkeyRegistered = globalShortcut.register('CommandOrControl+Shift+T', () => {
    console.log('Global hotkey invoked.');
    if (!mainWindow) {
      createWindow();
    } else {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  if (!hotkeyRegistered) {
    console.log('Global hotkey registration failed');
  }
});

app.on('will-quit', () => {
  if (nextServerProcess) {
    nextServerProcess.kill();
  }
  globalShortcut.unregisterAll();
  console.log('App is quitting; unregistered all global shortcuts.');
});

app.on('window-all-closed', () => {
  console.log('All windows closed.');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
