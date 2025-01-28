const { contextBridge, ipcRenderer } = require('electron');

// Validate the exposed API methods
const isValidKey = (key) => typeof key === 'string' && key.length > 0;
const isValidValue = (value) => typeof value === 'string' && value.length > 0;

contextBridge.exposeInMainWorld('electronAPI', {
  // LocalStorage methods with validation
  setLocalStorage: (key, value) => {
    try {
      if (!isValidKey(key) || !isValidValue(value)) {
        throw new Error('Invalid key or value for localStorage');
      }
      localStorage.setItem(key, value);
      return { status: 'success', key };
    } catch (error) {
      console.error('setLocalStorage error:', error);
      return { status: 'error', message: error.message };
    }
  },

  getLocalStorage: (key) => {
    try {
      if (!isValidKey(key)) {
        throw new Error('Invalid key for localStorage');
      }
      return localStorage.getItem(key);
    } catch (error) {
      console.error('getLocalStorage error:', error);
      return null;
    }
  },

  // Cookie methods with security flags
  setCookie: (name, value, days = 7, options = {}) => {
    try {
      if (!isValidKey(name) || !isValidValue(value)) {
        throw new Error('Invalid cookie name or value');
      }

      const date = new Date();
      date.setTime(date.getTime() + (days * 864e5));
      
      const cookieAttributes = [
        `expires=${date.toUTCString()}`,
        'path=/',
        'SameSite=Strict',
        options.secure ? 'Secure' : '',
        options.httpOnly ? 'HttpOnly' : ''
      ].filter(Boolean).join('; ');

      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${cookieAttributes}`;
      return { status: 'success', name };
    } catch (error) {
      console.error('setCookie error:', error);
      return { status: 'error', message: error.message };
    }
  },

  getCookie: (name) => {
    try {
      if (!isValidKey(name)) {
        throw new Error('Invalid cookie name');
      }
      
      return document.cookie
        .split('; ')
        .find(row => row.startsWith(`${encodeURIComponent(name)}=`))
        ?.split('=')[1]
        ?.replace(/%([0-9A-F]{2})/g, (match, p1) => 
          String.fromCharCode(parseInt(p1, 16))
        ) || null;
    } catch (error) {
      console.error('getCookie error:', error);
      return null;
    }
  },

  // Additional security measures
  removeCookie: (name) => {
    try {
      if (!isValidKey(name)) {
        throw new Error('Invalid cookie name for removal');
      }
      document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      return { status: 'success', name };
    } catch (error) {
      console.error('removeCookie error:', error);
      return { status: 'error', message: error.message };
    }
  },

  // Safe IPC communication example
  getServerStatus: () => {
    return ipcRenderer.invoke('get-server-status')
      .then(data => ({ status: 'success', data }))
      .catch(error => ({ status: 'error', message: error.message }));
  }
});

// Security: Freeze the exposed API
Object.freeze(window.electronAPI);