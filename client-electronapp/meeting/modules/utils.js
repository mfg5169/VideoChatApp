// Utility functions
class Utils {
  static async copyMeetingId() {
    if (window.Logger) {
      window.Logger.debug('UTILS', 'Copy meeting ID action initiated');
    }
    
    const meetingIdElement = document.getElementById('meetingId');
    const copyButton = document.getElementById('copyMeetingIdBtn');
    const copyIcon = copyButton.querySelector('i');
    
    // Extract the meeting ID from the text (remove "ID: " prefix)
    const meetingIdText = meetingIdElement.textContent;
    const meetingId = meetingIdText.replace('ID: ', '');
    
    if (meetingId === 'Loading...') {
      if (window.Logger) {
        window.Logger.warn('UTILS', 'Attempted to copy meeting ID while still loading');
      }
      return; // Don't copy if still loading
    }
    
    try {
      // Copy to clipboard
      await navigator.clipboard.writeText(meetingId);
      
      if (window.Logger) {
        window.Logger.info('UTILS', 'Meeting ID copied to clipboard successfully', { meetingId });
      }
      
      // Visual feedback - change icon to checkmark
      copyIcon.className = 'fas fa-check text-sm';
      copyButton.classList.remove('text-gray-400', 'hover:text-white');
      copyButton.classList.add('text-green-400');
      copyButton.title = 'Copied!';
      
      // Reset after 2 seconds
      setTimeout(() => {
        copyIcon.className = 'fas fa-copy text-sm';
        copyButton.classList.remove('text-green-400');
        copyButton.classList.add('text-gray-400', 'hover:text-white');
        copyButton.title = 'Copy meeting ID';
        if (window.Logger) {
          window.Logger.debug('UTILS', 'Copy button reset to original state');
        }
      }, 2000);
      
    } catch (err) {
      if (window.Logger) {
        window.Logger.error('UTILS', 'Failed to copy meeting ID using clipboard API', err, { meetingId });
      }
      
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = meetingId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (window.Logger) {
          window.Logger.info('UTILS', 'Meeting ID copied using fallback method', { meetingId });
        }
        
        // Still show success feedback
        copyIcon.className = 'fas fa-check text-sm';
        copyButton.classList.remove('text-gray-400', 'hover:text-white');
        copyButton.classList.add('text-green-400');
        copyButton.title = 'Copied!';
        
        setTimeout(() => {
          copyIcon.className = 'fas fa-copy text-sm';
          copyButton.classList.remove('text-green-400');
          copyButton.classList.add('text-gray-400', 'hover:text-white');
          copyButton.title = 'Copy meeting ID';
        }, 2000);
      } catch (fallbackError) {
        if (window.Logger) {
          window.Logger.error('UTILS', 'Fallback copy method also failed', fallbackError, { meetingId });
        }
      }
    }
  }

  static closeStream() {
    if (window.Logger) {
      window.Logger.info('UTILS', 'Closing stream and cleaning up meeting');
    }
    
    try {
      const mainVideo = document.getElementById('mainVideo');
      const screenVideo = document.getElementById('screenVideo');
      mainVideo.srcObject = null;
      document.getElementById('meetingId').textContent = 'N/A';
      document.getElementById('meetingTitle').textContent = 'Meeting Room';
      document.getElementById('copyMeetingIdBtn').disabled = true;
      document.getElementById('copyMeetingIdBtn').classList.add('opacity-50');
      document.getElementById('copyMeetingIdBtn').classList.remove('cursor-pointer');
      document.getElementById('copyMeetingIdBtn').classList.remove('hover:bg-gray-700');
      document.getElementById('copyMeetingIdBtn').classList.remove('hover:text-white');
      document.getElementById('copyMeetingIdBtn').classList.remove('hover:text-gray-400');
      
      if (window.Logger) {
        window.Logger.info('UTILS', 'UI elements reset for stream closure');
      }
      
      if (window.signalingManager && window.signalingManager.isConnected()) {
        if (window.Logger) {
          window.Logger.info('UTILS', 'Sending leave meeting message and closing WebSocket');
        }
        window.signalingManager.leaveMeeting(window.AppState?.meetingId);
        window.signalingManager.close();
      } else {
        if (window.Logger) {
          window.Logger.info('UTILS', 'WebSocket not available, cleaning up directly');
        }
      }
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('UTILS', 'Error during stream closure', error);
      }
    }
  }

  static leaveMeeting() {
    if (confirm('Are you sure you want to leave the meeting?')) {
      this.closeStream();
      window.location.href = '../home/index.html';
    }
  }

  static updateMeetingUI(meetingId, meetingName) {
    try {
      document.getElementById('meetingId').textContent = `ID: ${meetingId}`;
      document.getElementById('meetingTitle').textContent = `Meeting ${meetingName}`;
      
      if (window.Logger) {
        window.Logger.info('UTILS', 'Meeting interface elements updated', {
          meetingId: meetingId,
          meetingName: meetingName
        });
      }
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('UTILS', 'Failed to update meeting interface', error);
      }
    }
  }

  static resetUI() {
    try {
      document.getElementById('meetingId').textContent = 'ID: Loading...';
      document.getElementById('meetingTitle').textContent = 'Meeting Room';
      document.getElementById('copyMeetingIdBtn').disabled = false;
      document.getElementById('copyMeetingIdBtn').classList.remove('opacity-50');
      document.getElementById('copyMeetingIdBtn').classList.add('cursor-pointer');
      document.getElementById('copyMeetingIdBtn').classList.add('hover:bg-gray-700');
      document.getElementById('copyMeetingIdBtn').classList.add('hover:text-white');
      document.getElementById('copyMeetingIdBtn').classList.add('hover:text-gray-400');
      
      if (window.Logger) {
        window.Logger.info('UTILS', 'UI elements reset to default state');
      }
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('UTILS', 'Failed to reset UI elements', error);
      }
    }
  }

  static generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  static formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  static throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
} else {
  window.Utils = Utils;
}
