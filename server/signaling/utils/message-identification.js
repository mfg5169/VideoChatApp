// Helper function to identify message source with detailed client information
function identifyMessageSource(senderId) {
  if (!senderId) return { type: 'unknown', id: 'unknown', details: 'Unknown sender' };
  
  // SFU identification
  if (senderId.startsWith('sfu-')) {
    return {
      type: 'sfu',
      id: senderId,
      details: `SFU instance ${senderId}`
    };
  }
  
  // Client identification with more detail
  if (senderId.match(/^\d+$/)) {
    return {
      type: 'client',
      id: senderId,
      details: `Client ID ${senderId}`,
      clientType: 'numeric',
      clientCategory: 'user'
    };
  }
  
  // UUID-style client IDs
  if (senderId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return {
      type: 'client',
      id: senderId,
      details: `Client UUID ${senderId.substring(0, 8)}...`,
      clientType: 'uuid',
      clientCategory: 'session'
    };
  }
  
  // Electron app client IDs (often contain 'electron' or specific patterns)
  if (senderId.toLowerCase().includes('electron') || senderId.match(/^electron-/)) {
    return {
      type: 'client',
      id: senderId,
      details: `Electron Client ${senderId}`,
      clientType: 'electron',
      clientCategory: 'desktop'
    };
  }
  
  // Web browser client IDs (often contain 'chrome', 'firefox', 'safari', etc.)
  if (senderId.toLowerCase().match(/(chrome|firefox|safari|edge|opera)/)) {
    return {
      type: 'client',
      id: senderId,
      details: `Browser Client ${senderId}`,
      clientType: 'browser',
      clientCategory: 'web'
    };
  }
  
  // Mobile client IDs (often contain 'mobile', 'android', 'ios', etc.)
  if (senderId.toLowerCase().match(/(mobile|android|ios|phone|tablet)/)) {
    return {
      type: 'client',
      id: senderId,
      details: `Mobile Client ${senderId}`,
      clientType: 'mobile',
      clientCategory: 'mobile'
    };
  }
  
  // Alphanumeric client IDs
  if (senderId.match(/^[a-zA-Z0-9]+$/)) {
    return {
      type: 'client',
      id: senderId,
      details: `Client ${senderId}`,
      clientType: 'alphanumeric',
      clientCategory: 'generic'
    };
  }
  
  // Default for other formats
  return {
    type: 'client',
    id: senderId,
    details: `Client ${senderId}`,
    clientType: 'other'
  };
}

module.exports = {
  identifyMessageSource
};
