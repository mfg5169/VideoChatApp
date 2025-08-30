// Main meeting orchestrator - much smaller and cleaner
console.log('🚀 CLIENT SCRIPT LOADED - Modular version');
console.log('🚀 Current time:', new Date().toISOString());

// Initialize all managers
let mediaManager, webrtcManager, signalingManager, participantsManager, chatManager;

// Initialize meeting
document.addEventListener('DOMContentLoaded', function() {
  if (window.Logger) {
    window.Logger.info('DOM', 'DOM content loaded, initializing meeting interface');
  }
  
  try {
    // Initialize state
    const { meetingID, meetingName, user } = window.AppState.initialize();
    
    // Update UI
    window.Utils.updateMeetingUI(meetingID, meetingName);
    
    if (window.Logger) {
      window.Logger.info('DOM', 'Meeting interface elements updated', {
        meetingId: meetingID,
        meetingName: meetingName
      });
    }
    
    // Initialize managers
    initializeManagers();
    
    // Set up callbacks
    setupCallbacks();
    
    // Initialize video streams
    mediaManager.initializeVideoStreams();
    
    // Set up chat input event listeners
    chatManager.setupChatHandlers();
    
    if (window.Logger) {
      window.Logger.info('DOM', 'Meeting initialization completed successfully');
    }
  } catch (error) {
    if (window.Logger) {
      window.Logger.error('DOM', 'Failed to initialize meeting interface', error);
    }
  }
});

function initializeManagers() {
  // Initialize media manager
  mediaManager = new window.MediaManager();
  
  // Initialize WebRTC manager
  webrtcManager = new window.WebRTCManager();
  
  // Initialize signaling manager
  signalingManager = new window.SignalingManager();
  signalingManager.initialize(window.AppState.signalingUrl);
  
  // Initialize participants manager
  participantsManager = new window.ParticipantsManager();
  
  // Initialize chat manager
  chatManager = new window.ChatManager();
  
  if (window.Logger) {
    window.Logger.info('INIT', 'All managers initialized');
  }
}

function setupCallbacks() {
  // Media manager callbacks
  mediaManager.setCallbacks({
    onStreamReady: (stream) => {
      if (window.Logger) {
        window.Logger.info('STREAM', 'Local stream ready, initializing WebSocket connection');
      }
      signalingManager.connect();
    },
    onStreamError: (error) => {
      if (window.Logger) {
        window.Logger.error('STREAM', 'Stream initialization failed', error);
      }
    }
  });

  // WebRTC manager callbacks
  webrtcManager.setCallbacks({
    onTrack: (event) => {
      const remoteStream = event.streams[0];
      if (remoteStream) {
        const remotePeerId = event.track.id || `peer-${Date.now()}`;
        const participantName = event.track.label || `Participant ${remotePeerId.slice(0, 8)}`;
        participantsManager.addRemoteVideo(remotePeerId, remoteStream, participantName);
      }
    },
    onConnectionStateChange: (state) => {
      if (window.Logger) {
        window.Logger.info('WEBRTC', 'Connection state changed', { state });
      }
    },
    onNegotiationNeeded: async () => {
      try {
        const offer = await webrtcManager.createOffer();
        signalingManager.sendOffer(offer.sdp);
        if (window.Logger) {
          window.Logger.info('WEBRTC', 'Offer sent to SFU successfully');
        }
      } catch (error) {
        if (window.Logger) {
          window.Logger.error('WEBRTC', 'Error creating or sending offer', error);
        }
      }
    },
    onIceCandidate: (candidate) => {
      signalingManager.sendIceCandidate(candidate);
    }
  });

  // Signaling manager callbacks
  signalingManager.setCallbacks({
    onOpen: () => {
      if (window.Logger) {
        window.Logger.info('SIGNALING', 'WebSocket connected, registering with signaling server');
      }
      signalingManager.register(window.AppState.userId, 'client');
      signalingManager.joinMeeting(window.AppState.meetingId);
    },
    onMessage: (message) => {
      handleSignalingMessage(message);
    },
    onClose: (event) => {
      if (window.Logger) {
        window.Logger.info('SIGNALING', 'WebSocket closed', { event });
      }
      cleanup();
    },
    onError: (error) => {
      if (window.Logger) {
        window.Logger.error('SIGNALING', 'WebSocket error', error);
      }
    }
  });

  // Participants manager callbacks
  participantsManager.setCallbacks({
    onParticipantAdded: (peerId, name, stream) => {
      if (window.Logger) {
        window.Logger.info('PARTICIPANTS', 'Participant added', { peerId, name });
      }
    },
    onParticipantRemoved: (peerId) => {
      if (window.Logger) {
        window.Logger.info('PARTICIPANTS', 'Participant removed', { peerId });
      }
    }
  });

  // Chat manager callbacks
  chatManager.setCallbacks({
    onMessageReceived: (message) => {
      if (window.Logger) {
        window.Logger.debug('CHAT', 'Message received', { messageId: message.id });
      }
    },
    onMessageSent: (message) => {
      if (window.Logger) {
        window.Logger.debug('CHAT', 'Message sent', { messageId: message.id });
      }
    }
  });
}

async function handleSignalingMessage(message) {
  if (window.Logger) {
    window.Logger.debug('SIGNALING', 'Processing signaling message', {
      type: message.type,
      hasPayload: !!message.payload
    });
  }

  try {
    // Handle WebRTC messages
    if (['answer', 'offer', 'candidate'].includes(message.type)) {
      await webrtcManager.handleSignalingMessage(message);
      return;
    }

    // Handle chat messages
    if (message.type === 'chat') {
      chatManager.handleIncomingMessage(message.payload);
      return;
    }

    // Handle meeting events
    if (message.type === 'meetingEvent') {
      if (window.Logger) {
        window.Logger.info('SIGNALING', 'Received meeting event', {
          eventType: message.payload.type,
          clientId: message.payload.payload?.clientId
        });
      }
      
      if (message.payload.type === 'clientLeft') {
        const clientId = message.payload.payload.clientId;
        participantsManager.removeRemoteVideo(clientId);
      } else if (message.payload.type === 'clientJoined') {
        const clientId = message.payload.payload.clientId;
        const clientName = message.payload.payload.name || `Participant ${clientId.slice(0, 8)}`;
        if (window.Logger) {
          window.Logger.info('SIGNALING', 'Client joined meeting', { clientId, clientName });
        }
      }
      return;
    }

    // Handle meeting joined confirmation
    if (message.type === 'meetingJoined') {
      if (window.Logger) {
        window.Logger.info('SIGNALING', 'Meeting joined confirmation received', {
          meetingId: message.payload.meetingId,
          success: message.payload.success
        });
      }
      
      if (message.payload.success) {
        if (window.Logger) {
          window.Logger.info('SIGNALING', 'Creating PeerConnection after meeting confirmation');
        }
        webrtcManager.createPeerConnection(mediaManager.getLocalStream());
      }
      return;
    }

    // Handle errors
    if (message.type === 'error') {
      if (window.Logger) {
        window.Logger.error('SIGNALING', 'Signaling error from server', null, {
          errorMessage: message.payload.message
        });
      }
      alert('Server Error: ' + message.payload.message);
      return;
    }

    // Unknown message type
    if (window.Logger) {
      window.Logger.warn('SIGNALING', 'Unknown message type received', null, {
        type: message.type,
        payload: message.payload
      });
    }
    
  } catch (error) {
    if (window.Logger) {
      window.Logger.error('SIGNALING', 'Error handling signaling message', error, {
        messageType: message.type,
        messagePayload: message.payload
      });
    }
  }
}

function cleanup() {
  if (window.Logger) {
    window.Logger.info('CLEANUP', 'Starting cleanup of all managers');
  }
  
  try {
    // Cleanup all managers
    if (mediaManager) mediaManager.cleanup();
    if (webrtcManager) webrtcManager.cleanup();
    if (signalingManager) signalingManager.close();
    if (participantsManager) participantsManager.cleanup();
    if (chatManager) chatManager.cleanup();
    
    if (window.Logger) {
      window.Logger.info('CLEANUP', 'All managers cleaned up successfully');
    }
  } catch (error) {
    if (window.Logger) {
      window.Logger.error('CLEANUP', 'Error during cleanup', error);
    }
  }
}

// Global functions for UI interactions
window.toggleAudio = function() {
  const newState = !window.AppState.isAudioEnabled;
  mediaManager.toggleAudio(newState);
  
  const audioBtn = document.getElementById('audioBtn');
  if (newState) {
    audioBtn.innerHTML = '<i class="fas fa-microphone text-lg"></i>';
    audioBtn.className = 'control-button primary';
  } else {
    audioBtn.innerHTML = '<i class="fas fa-microphone-slash text-lg"></i>';
    audioBtn.className = 'control-button danger';
  }
};

window.toggleVideo = function() {
  const newState = !window.AppState.isVideoEnabled;
  mediaManager.toggleVideo(newState);
  
  const videoBtn = document.getElementById('videoBtn');
  if (newState) {
    videoBtn.innerHTML = '<i class="fas fa-video text-lg"></i>';
    videoBtn.className = 'control-button primary';
  } else {
    videoBtn.innerHTML = '<i class="fas fa-video-slash text-lg"></i>';
    videoBtn.className = 'control-button danger';
  }
};

window.toggleScreenShare = function() {
  const newState = !window.AppState.isScreenSharing;
  
  if (newState) {
    mediaManager.getSharedScreenStream().then(() => {
      mediaManager.toggleScreenSharing(true);
      
      const screenShareBtn = document.getElementById('screenShareBtn');
      screenShareBtn.innerHTML = '<i class="fas fa-stop text-lg"></i>';
      screenShareBtn.className = 'control-button danger';
    }).catch(error => {
      if (window.Logger) {
        window.Logger.error('SCREEN', 'Failed to start screen sharing', error);
      }
    });
  } else {
    mediaManager.toggleScreenSharing(false);
    
    const screenShareBtn = document.getElementById('screenShareBtn');
    screenShareBtn.innerHTML = '<i class="fas fa-desktop text-lg"></i>';
    screenShareBtn.className = 'control-button secondary';
  }
};

window.copyMeetingId = function() {
  window.Utils.copyMeetingId();
};

window.leaveMeeting = function() {
  window.Utils.leaveMeeting();
};

// Debug helpers
window.debugClient = {
  showState: () => {
    console.log('📊 Current App State:', window.AppState.getState());
    return window.AppState.getState();
  },
  
  showLoggerStats: () => {
    console.log('📊 Logger Level:', window.Logger.currentLevel);
    console.log('📊 Available Levels:', window.Logger.levels);
    return { level: window.Logger.currentLevel, levels: window.Logger.levels };
  },
  
  setLogLevel: (level) => {
    if (window.Logger.levels[level] !== undefined) {
      window.Logger.currentLevel = window.Logger.levels[level];
      console.log(`📊 Logger level set to: ${level}`);
      return true;
    } else {
      console.error(`❌ Invalid log level: ${level}. Available: ${Object.keys(window.Logger.levels).join(', ')}`);
      return false;
    }
  },
  
  testLogs: () => {
    console.log('🧪 Testing all log levels...');
    window.Logger.debug('DEBUG_TEST', 'This is a debug message', { test: true });
    window.Logger.info('INFO_TEST', 'This is an info message', { test: true });
    window.Logger.warn('WARN_TEST', 'This is a warning message', { test: true });
    window.Logger.error('ERROR_TEST', 'This is an error message', new Error('Test error'), { test: true });
  }
};

console.log('🔧 Debug helpers available: window.debugClient.showState(), window.debugClient.testLogs(), etc.');

// Log initial application state
if (window.Logger) {
  window.Logger.info('APP', 'Application initialized', window.AppState.getState());
}
