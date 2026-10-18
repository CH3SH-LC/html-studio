'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
if(process.isMainFrame)contextBridge.exposeInMainWorld('studio',{
  async command(name,payload){
    const allowed=['bootstrap','open','commit','history','save','selectImage','locateAssets','play','page','reload','restore','discardRecovery','state','close','home','showFile'];
    if(!allowed.includes(name))throw new Error('不支持的操作。');
    const response=await ipcRenderer.invoke('studio:command',name,payload);
    if(!response.ok){const error=new Error(response.error);error.code=response.code;throw error;}
    return response.result;
  },
  droppedPath(file){return webUtils.getPathForFile(file);},
  onEvent(callback){ipcRenderer.on('studio:event',(_event,value)=>callback(value));}
});
