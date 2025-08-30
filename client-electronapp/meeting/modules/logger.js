// Production-level logging utility
const Logger = {
  levels: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  },
  currentLevel: 1, // INFO level by default
  
  formatMessage(level, component, message, data = null) {
    const timestamp = new Date().toISOString();
    const logLevel = Object.keys(this.levels)[level];
    
    // Get function call information
    const stack = new Error().stack;
    const caller = this.getCallerInfo(stack);
    
    const prefix = `[${timestamp}] [${logLevel}] [${component}] [${caller}]`;
    
    if (data) {
      return [`${prefix} ${message}`, data];
    }
    return [`${prefix} ${message}`];
  },
  
  getCallerInfo(stack) {
    try {
      // Split stack into lines and find the caller (skip the first 3 lines: Error, formatMessage, and the logging method)
      const lines = stack.split('\n');
      if (lines.length >= 4) {
        const callerLine = lines[3];
        // Extract function name and file info
        const match = callerLine.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
          const functionName = match[1];
          const filePath = match[2];
          const lineNumber = match[3];
          
          // Extract just the filename from the full path
          const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
          
          return `${functionName}@${fileName}:${lineNumber}`;
        }
      }
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  },
  
  debug(component, message, data = null) {
    if (this.currentLevel <= this.levels.DEBUG) {
      console.debug(...this.formatMessage(this.levels.DEBUG, component, message, data));
    }
  },
  
  info(component, message, data = null) {
    if (this.currentLevel <= this.levels.INFO) {
      console.info(...this.formatMessage(this.levels.INFO, component, message, data));
    }
  },
  
  warn(component, message, data = null) {
    if (this.currentLevel <= this.levels.WARN) {
      console.warn(...this.formatMessage(this.levels.WARN, component, message, data));
    }
  },
  
  error(component, message, error = null, data = null) {
    if (this.currentLevel <= this.levels.ERROR) {
      console.error(...this.formatMessage(this.levels.ERROR, component, message, data));
      if (error) {
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
      }
    }
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Logger;
} else {
  window.Logger = Logger;
}
