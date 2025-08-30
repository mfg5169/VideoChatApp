// WebSocket signaling communication
class SignalingManager {
  constructor() {
    this.ws = null;
    this.signalingUrl = null;
    this.onMessageCallback = null;
    this.onOpenCallback = null;
    this.onCloseCallback = null;
    this.onErrorCallback = null;
  }

  setCallbacks(callbacks) {
    this.onMessageCallback = callbacks.onMessage;
    this.onOpenCallback = callbacks.onOpen;
    this.onCloseCallback = callbacks.onClose;
    this.onErrorCallback = callbacks.onError;
  }

  initialize(signalingUrl) {
    this.signalingUrl = signalingUrl;
    
    if (window.Logger) {
      window.Logger.info('SIGNALING', 'Signaling server URL from session storage', {
        assignedSignalingServerUrl: signalingUrl
      });
    }
  }

  connect() {
    if (window.Logger) {
      window.Logger.info('WEBSOCKET', 'Initializing WebSocket connection');
    }
    
    if (!this.signalingUrl) {
      if (window.Logger) {
        window.Logger.warn('WEBSOCKET', 'No signaling server URL found, using default');
      }
      this.signalingUrl = 'ws://localhost:8080';
    }
    
    if (window.Logger) {
      window.Logger.info('WEBSOCKET', 'WebSocket creation initiated', { signalingUrl: this.signalingUrl });
    }

    try {
      this.ws = new WebSocket(this.signalingUrl);
      this.setupEventHandlers();
      
      if (window.Logger) {
        window.Logger.info('WEBSOCKET', 'WebSocket event handlers configured');
      }
      
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('WEBSOCKET', 'Failed to create WebSocket connection', error, {
          signalingUrl: this.signalingUrl
        });
      }
      throw error;
    }
  }

  setupEventHandlers() {
    this.ws.onopen = () => {
      if (window.Logger) {
        window.Logger.info('WEBSOCKET', 'Connected to signaling server', {
          url: this.signalingUrl,
          readyState: this.ws.readyState
        });
      }
      
      if (window.AppState) {
        window.AppState.updateState({ WSconnectionState: 'connected' });
      }
      
      if (this.onOpenCallback) {
        this.onOpenCallback();
      }
    };
    
    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (window.Logger) {
          window.Logger.debug('WEBSOCKET', 'Received message from signaling server', {
            messageType: message.type,
            messageSize: event.data.length,
            messagePayload: message.payload
          });
        }
        
        if (this.onMessageCallback) {
          this.onMessageCallback(message);
        }
      } catch (error) {
        if (window.Logger) {
          window.Logger.error('WEBSOCKET', 'Failed to parse received message', error, {
            rawData: event.data
          });
        }
      }
    };
    
    this.ws.onclose = (event) => {
      if (window.Logger) {
        window.Logger.info('WEBSOCKET', 'Disconnected from signaling server', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
      }
      
      if (window.AppState) {
        window.AppState.updateState({ WSconnectionState: 'disconnected' });
      }
      
      if (this.onCloseCallback) {
        this.onCloseCallback(event);
      }
    };
    
    this.ws.onerror = (error) => {
      if (window.Logger) {
        window.Logger.error('WEBSOCKET', 'WebSocket error occurred', error);
      }
      
      if (window.AppState) {
        window.AppState.updateState({ WSconnectionState: 'error' });
      }
      
      if (this.onErrorCallback) {
        this.onErrorCallback(error);
      }
    };
  }

  sendMessage(type, payload) {
    if (window.Logger) {
      window.Logger.debug('SIGNALING', 'Preparing to send message', { type, payload });
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { 
        type: type, 
        payload: payload,
        senderId: window.AppState?.userId,
        meetingId: window.AppState?.meetingId
      };

      if (window.Logger) {
        window.Logger.info('SIGNALING', 'Sending message to signaling server', message);
      }
      
      try {
        this.ws.send(JSON.stringify(message));
        if (window.Logger) {
          window.Logger.debug('SIGNALING', 'Message sent successfully', { 
            type, 
            messageSize: JSON.stringify(message).length 
          });
        }
      } catch (error) {
        if (window.Logger) {
          window.Logger.error('SIGNALING', 'Failed to send message', error, { type, payload });
        }
      }
    } else {
      if (window.Logger) {
        window.Logger.error('SIGNALING', 'WebSocket not connected or not open', null, {
          wsExists: !!this.ws,
          wsReadyState: this.ws ? this.ws.readyState : 'null',
          wsReadyStateText: this.ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws.readyState] : 'null'
        });
      }
    }
  }

  register(userId, role = 'client') {
    this.sendMessage('register', { id: userId, role: role });
  }

  joinMeeting(meetingId) {
    this.sendMessage('joinMeeting', { meetingId: meetingId });
  }

  leaveMeeting(meetingId) {
    this.sendMessage('leaveMeeting', { meetingId: meetingId });
  }

  sendOffer(sdp) {
    this.sendMessage('offer', { sdp: sdp });
  }

  sendAnswer(sdp) {
    this.sendMessage('answer', { sdp: sdp });
  }

  sendIceCandidate(candidate) {
    this.sendMessage('candidate', { 
      candidate: candidate, 
      clientID: window.AppState?.userId, 
      meetingID: window.AppState?.meetingId 
    });
  }

  sendChatMessage(chatMessage) {
    this.sendMessage('chat', chatMessage);
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SignalingManager;
} else {
  window.SignalingManager = SignalingManager;
}
