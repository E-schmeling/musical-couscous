const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const FLASK_PORT = 5050;
let mainWindow;
let pythonProcess;
let isQuitting = false;

function getPackagedBackendBasename() {
  return process.platform === 'win32' ? 'architecture-backend.exe' : 'architecture-backend';
}

function getBackendLaunchConfig() {
  if (app.isPackaged) {
    const packagedBackendName = getPackagedBackendBasename();
    const packagedCandidates = [
      path.join(process.resourcesPath, 'backend', packagedBackendName),
      path.join(path.dirname(process.execPath), 'resources', 'backend', packagedBackendName),
      path.join(path.dirname(process.execPath), 'backend', packagedBackendName)
    ];
    const packagedBackendPath = packagedCandidates.find((candidate) => fs.existsSync(candidate));

    if (!packagedBackendPath) {
      return {
        command: packagedCandidates[0],
        args: [],
        missingCandidates: packagedCandidates
      };
    }

    return {
      command: packagedBackendPath,
      args: []
    };
  }

  const venvCandidates = [
    path.join(__dirname, 'backend', 'venv', 'Scripts', 'python.exe'),
    path.join(__dirname, 'backend', 'venv', 'bin', 'python.exe'),
    path.join(__dirname, 'backend', 'venv', 'bin', 'python'),
    path.join(__dirname, '.venv', 'Scripts', 'python.exe')
  ];
  const devPython = venvCandidates.find((candidate) => fs.existsSync(candidate));

  if (devPython) {
    return {
      command: devPython,
      args: [path.join(__dirname, 'backend', 'server.py')]
    };
  }

  return {
    command: process.platform === 'win32' ? 'python' : 'python3',
    args: [path.join(__dirname, 'backend', 'server.py')]
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 720,
    backgroundColor: '#ebe6da',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'Dashboard.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startPythonServer() {
  const { command, args, missingCandidates } = getBackendLaunchConfig();

  if (missingCandidates) {
    dialog.showErrorBox(
      'Backend Missing',
      `Electron could not find the packaged backend executable.\n\nChecked:\n${missingCandidates.join('\n')}`
    );
    return;
  }

  pythonProcess = spawn(command, args, {
    cwd: path.dirname(command),
    env: {
      ...process.env,
      FLASK_PORT: String(FLASK_PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[python] ${data.toString().trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[python] ${data.toString().trim()}`);
  });

  pythonProcess.on('error', (error) => {
    dialog.showErrorBox(
      'Backend Failed To Start',
      `Electron could not launch the Flask backend.\n\n${error.message}\n\nTried:\n${command}`
    );
  });

  pythonProcess.on('exit', (code) => {
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox(
        'Backend Stopped',
        `The Flask backend exited unexpectedly with code ${code}.`
      );
    }
  });
}

function stopPythonServer() {
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

app.whenReady().then(() => {
  startPythonServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  stopPythonServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
