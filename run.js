// VS Code's extension host sets ELECTRON_RUN_AS_NODE=1, which makes the Electron
// binary boot as plain Node — app/ipcMain come back undefined. Strip it before launching.
const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

spawn(electron, [__dirname, ...process.argv.slice(2)], { env, stdio: "inherit" })
  .on("exit", (code) => process.exit(code ?? 0));
