// Chat functionality management
class ChatManager {
  constructor() {
    this.chatMessages = [];
    this.onMessageReceivedCallback = null;
    this.onMessageSentCallback = null;
  }

  setCallbacks(callbacks) {
    this.onMessageReceivedCallback = callbacks.onMessageReceived;
    this.onMessageSentCallback = callbacks.onMessageSent;
  }

  setupChatHandlers() {
    if (window.Logger) {
      window.Logger.info('CHAT', 'Setting up chat input handlers');
    }
    
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      // Handle Enter key press
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (window.Logger) {
            window.Logger.debug('CHAT', 'Enter key pressed, sending message');
          }
          this.sendChatMessage();
        }
      });
      
      // Handle send button click
      const sendButton = document.querySelector('button[onclick="sendMessage()"]');
      if (sendButton) {
        sendButton.onclick = () => this.sendChatMessage();
        if (window.Logger) {
          window.Logger.debug('CHAT', 'Send button click handler attached');
        }
      } else {
        if (window.Logger) {
          window.Logger.warn('CHAT', 'Send button not found in DOM');
        }
      }
      
      if (window.Logger) {
        window.Logger.info('CHAT', 'Chat input handlers configured successfully');
      }
    } else {
      if (window.Logger) {
        window.Logger.error('CHAT', 'Chat input element not found in DOM');
      }
    }
  }

  sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (!message) {
      if (window.Logger) {
        window.Logger.debug('CHAT', 'Empty message, ignoring send request');
      }
      return;
    }
    
    if (window.Logger) {
      window.Logger.info('CHAT', 'Sending chat message', { messageLength: message.length });
    }
    
    // Create message object
    const chatMessage = {
      id: this.generateMessageId(),
      senderId: window.AppState?.userId,
      senderName: window.AppState?.userName || 'You',
      message: message,
      timestamp: new Date().toISOString(),
      type: 'chat'
    };
    
    // Send to signaling server
    if (window.signalingManager) {
      window.signalingManager.sendChatMessage(chatMessage);
    }
    
    // Add to local chat display
    this.addChatMessageToDisplay(chatMessage);
    
    // Clear input
    chatInput.value = '';
    
    if (window.Logger) {
      window.Logger.debug('CHAT', 'Chat message sent and displayed locally', {
        messageId: chatMessage.id,
        senderName: chatMessage.senderName
      });
    }
    
    if (this.onMessageSentCallback) {
      this.onMessageSentCallback(chatMessage);
    }
  }

  addChatMessageToDisplay(messageData) {
    if (window.Logger) {
      window.Logger.debug('CHAT', 'Adding chat message to display', {
        messageId: messageData.id,
        senderId: messageData.senderId,
        isOwnMessage: messageData.senderId === window.AppState?.userId
      });
    }
    
    const chatMessagesContainer = document.getElementById('chatMessages');
    if (!chatMessagesContainer) {
      if (window.Logger) {
        window.Logger.error('CHAT', 'Chat messages container not found in DOM');
      }
      return;
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    messageElement.id = `message-${messageData.id}`;
    
    const isOwnMessage = messageData.senderId === window.AppState?.userId;
    const senderName = isOwnMessage ? 'You' : messageData.senderName;
    const timeString = new Date(messageData.timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    const firstLetter = senderName.charAt(0).toUpperCase();
    const avatarColor = isOwnMessage ? 'bg-blue-600' : 'bg-green-600';
    
    messageElement.innerHTML = `
      <div class="flex items-start space-x-3">
        <div class="w-8 h-8 ${avatarColor} rounded-full flex items-center justify-center">
          <span class="text-sm font-medium">${firstLetter}</span>
        </div>
        <div class="flex-1">
          <div class="flex items-center space-x-2">
            <span class="font-medium text-sm">${senderName}</span>
            <span class="text-xs text-gray-400">${timeString}</span>
          </div>
          <p class="text-sm text-gray-300 mt-1">${this.escapeHtml(messageData.message)}</p>
        </div>
      </div>
    `;
    
    chatMessagesContainer.appendChild(messageElement);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    
    // Store message in local array
    this.chatMessages.push(messageData);
    if (window.AppState) {
      window.AppState.chatMessages = this.chatMessages;
    }
    
    if (window.Logger) {
      window.Logger.debug('CHAT', 'Chat message added to display', {
        messageId: messageData.id,
        totalMessages: this.chatMessages.length
      });
    }
    
    if (this.onMessageReceivedCallback) {
      this.onMessageReceivedCallback(messageData);
    }
  }

  handleIncomingMessage(messageData) {
    if (window.Logger) {
      window.Logger.info('CHAT', 'Received chat message', {
        senderId: messageData.senderId,
        messageLength: messageData.message?.length
      });
    }
    
    // Don't display our own messages twice
    if (messageData.senderId !== window.AppState?.userId) {
      this.addChatMessageToDisplay(messageData);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  generateMessageId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  getChatMessages() {
    return this.chatMessages;
  }

  clearChat() {
    this.chatMessages = [];
    const chatMessagesContainer = document.getElementById('chatMessages');
    if (chatMessagesContainer) {
      chatMessagesContainer.innerHTML = '';
    }
    
    if (window.AppState) {
      window.AppState.chatMessages = [];
    }
    
    if (window.Logger) {
      window.Logger.info('CHAT', 'Chat messages cleared');
    }
  }

  cleanup() {
    if (window.Logger) {
      window.Logger.info('CHAT', 'Cleaning up chat manager');
    }
    
    this.chatMessages = [];
    if (window.AppState) {
      window.AppState.chatMessages = [];
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChatManager;
} else {
  window.ChatManager = ChatManager;
}
