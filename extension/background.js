// @ts-check

/**
 * Simple Chrome Extension that pumps CDP messages between chrome.debugger and WebSocket
 */

function debugLog(...args) {
  const enabled = true;
  if (enabled) {
    console.log('[Extension]', ...args);
  }
}

class TabShareExtension {
  constructor() {
    this.activeConnections = new Map(); // tabId -> connection info
    this.bridgeURL = 'ws://localhost:9223/extension'; // Default bridge URL
    
    // Set up page action
    chrome.action.onClicked.addListener(this.onPageActionClicked.bind(this));
    chrome.tabs.onRemoved.addListener(this.onTabRemoved.bind(this));
  }

  /**
   * Handle page action click - "share" the tab with MCP server
   * @param {chrome.tabs.Tab} tab 
   */
  async onPageActionClicked(tab) {
    if (!tab.id) return;

    if (this.activeConnections.has(tab.id)) {
      // Already connected - disconnect
      await this.disconnectTab(tab.id);
      chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      chrome.action.setTitle({ tabId: tab.id, title: 'Share tab with Playwright MCP' });
    } else {
      // Connect tab
      await this.connectTab(tab.id);
    }
  }

  /**
   * Connect a tab to the bridge server
   * @param {number} tabId 
   */
  async connectTab(tabId) {
    try {
      debugLog(`Connecting tab ${tabId} to bridge`);

      // Attach chrome debugger
      const debuggee = { tabId };
      await chrome.debugger.attach(debuggee, '1.3');
      
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      // Get target info including browserContextId
      const targetInfo = await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo', {});
      debugLog('Target info:', targetInfo);

      // Connect to bridge server
      const socket = new WebSocket(this.bridgeURL);
      
      const connection = {
        debuggee,
        socket,
        tabId,
        targetId: targetInfo.targetInfo.targetId,
        browserContextId: targetInfo.targetInfo.browserContextId
      };

      await new Promise((resolve, reject) => {
        socket.onopen = () => {
          debugLog(`WebSocket connected for tab ${tabId}`);
          // Send initial connection info to bridge
          socket.send(JSON.stringify({
            type: 'connection_info',
            tabId,
            targetId: connection.targetId,
            browserContextId: connection.browserContextId,
            targetInfo: targetInfo.targetInfo
          }));
          resolve(undefined);
        };
        socket.onerror = reject;
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      // Set up message handling
      this.setupMessageHandling(connection);
      
      // Store connection
      this.activeConnections.set(tabId, connection);
      
      // Update UI
      chrome.action.setBadgeText({ tabId, text: '●' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
      chrome.action.setTitle({ tabId, title: 'Disconnect from Playwright MCP' });
      
      debugLog(`Tab ${tabId} connected successfully`);
      
    } catch (error) {
      debugLog(`Failed to connect tab ${tabId}:`, error.message);
      await this.cleanupConnection(tabId);
      
      // Show error to user
      chrome.action.setBadgeText({ tabId, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#F44336' });
      chrome.action.setTitle({ tabId, title: `Connection failed: ${error.message}` });
    }
  }

  /**
   * Set up bidirectional message handling between debugger and WebSocket
   * @param {Object} connection 
   */
  setupMessageHandling(connection) {
    const { debuggee, socket, tabId } = connection;

    // WebSocket -> chrome.debugger
    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        debugLog('Received from bridge:', message);
        
        // Forward CDP command to chrome.debugger
        if (message.method) {
          const result = await chrome.debugger.sendCommand(
            debuggee, 
            message.method, 
            message.params || {}
          );
          
          // Send response back to bridge
          const response = {
            id: message.id,
            result: result || {},
            sessionId: message.sessionId
          };
          
          if (chrome.runtime.lastError) {
            response.error = { message: chrome.runtime.lastError.message };
          }
          
          socket.send(JSON.stringify(response));
        }
      } catch (error) {
        debugLog('Error processing WebSocket message:', error);
      }
    };

    // chrome.debugger events -> WebSocket
    const eventListener = (source, method, params) => {
      if (source.tabId === tabId && socket.readyState === WebSocket.OPEN) {
        const event = {
          method,
          params,
          sessionId: 'bridge-session-1',
          targetId: connection.targetId,
          browserContextId: connection.browserContextId
        };
        debugLog('Forwarding CDP event:', event);
        socket.send(JSON.stringify(event));
      }
    };

    const detachListener = (source, reason) => {
      if (source.tabId === tabId) {
        debugLog(`Debugger detached from tab ${tabId}, reason: ${reason}`);
        this.disconnectTab(tabId);
      }
    };

    // Store listeners for cleanup
    connection.eventListener = eventListener;
    connection.detachListener = detachListener;

    chrome.debugger.onEvent.addListener(eventListener);
    chrome.debugger.onDetach.addListener(detachListener);

    // Handle WebSocket close
    socket.onclose = () => {
      debugLog(`WebSocket closed for tab ${tabId}`);
      this.disconnectTab(tabId);
    };

    socket.onerror = (error) => {
      debugLog(`WebSocket error for tab ${tabId}:`, error);
      this.disconnectTab(tabId);
    };
  }

  /**
   * Disconnect a tab from the bridge
   * @param {number} tabId 
   */
  async disconnectTab(tabId) {
    await this.cleanupConnection(tabId);
    
    // Update UI
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Share tab with Playwright MCP' });
    
    debugLog(`Tab ${tabId} disconnected`);
  }

  /**
   * Clean up connection resources
   * @param {number} tabId 
   */
  async cleanupConnection(tabId) {
    const connection = this.activeConnections.get(tabId);
    if (!connection) return;

    // Remove listeners
    if (connection.eventListener) {
      chrome.debugger.onEvent.removeListener(connection.eventListener);
    }
    if (connection.detachListener) {
      chrome.debugger.onDetach.removeListener(connection.detachListener);
    }

    // Close WebSocket
    if (connection.socket && connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.close();
    }

    // Detach debugger
    try {
      await chrome.debugger.detach(connection.debuggee);
    } catch (error) {
      // Ignore detach errors - might already be detached
    }

    this.activeConnections.delete(tabId);
  }

  /**
   * Handle tab removal
   * @param {number} tabId 
   */
  async onTabRemoved(tabId) {
    if (this.activeConnections.has(tabId)) {
      await this.cleanupConnection(tabId);
    }
  }
}

// Initialize extension
new TabShareExtension();