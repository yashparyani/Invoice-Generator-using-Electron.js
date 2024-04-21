const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
    'electron',
    {
        send: (channel, data) => {
            ipcRenderer.send(channel, data);
        },
        invoke: async (channel, data) => {
            return await ipcRenderer.invoke(channel, data);
        }
    }
);
