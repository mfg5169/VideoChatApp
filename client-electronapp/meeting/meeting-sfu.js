// TEST: Basic console test - this should appear immediately
console.log('🚀 CLIENT SCRIPT LOADED - Basic console test');
console.log('🚀 If you see this, the script is loading and console is working');
console.log('🚀 Current time:', new Date().toISOString());


// class WebRTCHandler {
//   constructor() {
//     this.peerConnection = null;
//     this.ICEbuffer = [];
//   }

//   addICECandidates(candidate) {
//     this.ICEbuffer.push(candidate);
//   }

//   createPeerConnection() {
//     this.peerConnection = new RTCPeerConnection(this.ICEbuffer);
//   }
// }
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

// TEST: Add a very visible test log to verify logging is working
console.log('🔍 CLIENT LOGGING TEST: This should be visible in the console');
console.log('🔍 CLIENT LOGGING TEST: If you see this, the console is working');
Logger.info('TEST', 'Client logging system initialized', { test: true, timestamp: new Date().toISOString() });
Logger.warn('TEST', 'This is a test warning message', { test: true });
Logger.error('TEST', 'This is a test error message', new Error('Test error'), { test: true });

// Global state tracking
const AppState = {
  meetingId: null,
  userId: null,
  userName: null,
  signalingUrl: null,
  connectionState: 'disconnected',
  peerConnectionState: 'new',
  localStreamState: 'not_initialized',
  remoteParticipants: new Map(),
  chatMessages: [],
  
  updateState(newState) {
    Object.assign(this, newState);
    Logger.info('STATE', 'Application state updated', this);
  },
  
  getState() {
    return {
      meetingId: this.meetingId,
      userId: this.userId,
      userName: this.userName,
      signalingUrl: this.signalingUrl,
      connectionState: this.connectionState,
      peerConnectionState: this.peerConnectionState,
      localStreamState: this.localStreamState,
      remoteParticipantsCount: this.remoteParticipants.size,
      chatMessagesCount: this.chatMessages.length
    };
  }
};

let isAudioEnabled = true;
let isVideoEnabled = true;
let isScreenSharing = false;
let isSidebarOpen = false;
let currentSidebar = 'chat';
let localStream = null;
let localVideo = null;
let ws = null;

// Get meeting ID from URL
const urlParams = new URLSearchParams(window.location.search);
Logger.info('INIT', 'URL Parameters parsed', { urlParams: Object.fromEntries(urlParams) });
const meetingID = urlParams.get('meetingId') || urlParams.get('meetingID') || 'DEMO-123';
const meetingName = sessionStorage.getItem('meetingName') || 'Meeting';

// Debug: Log what we're getting from sessionStorage
Logger.debug('INIT', 'SessionStorage data retrieved', {
  meetingName: sessionStorage.getItem('meetingName'),
  meetingId: sessionStorage.getItem('meetingId'),
  urlMeetingID: meetingID,
  finalMeetingName: meetingName
});

const user = JSON.parse(sessionStorage.getItem('user'));
Logger.info('INIT', 'User data loaded from session storage', {
  userId: user?.id,
  userName: user?.name,
  userEmail: user?.email
});

// Update global state
AppState.updateState({
  meetingId: meetingID,
  userId: user?.id,
  userName: user?.name || user?.email,
  signalingUrl: sessionStorage.getItem('assignedSignalingServerUrl')
});

// Remote participants management
let remoteVideoElements = new Map();
let remoteParticipants = new Map();

// Chat message handling
let chatMessages = [];

// Initialize meeting
document.addEventListener('DOMContentLoaded', function() {
  Logger.info('DOM', 'DOM content loaded, initializing meeting interface');
  
  try {
    document.getElementById('meetingId').textContent = `ID: ${meetingID}`;
    document.getElementById('meetingTitle').textContent = `Meeting ${meetingName}`;
    
    Logger.info('DOM', 'Meeting interface elements updated', {
      meetingId: meetingID,
      meetingName: meetingName
    });
    
    // Initialize video streams
    initializeVideoStreams();
    
    // Set up chat input event listeners
    setupChatHandlers();
    
    Logger.info('DOM', 'Meeting initialization completed successfully');
  } catch (error) {
    Logger.error('DOM', 'Failed to initialize meeting interface', error);
  }
});

async function initializeVideoStreams() {
  Logger.info('STREAM', 'Starting video stream initialization');
  
  //complex constraints are used to get the best quality video and audio
  const complexConstraints = {
    audio: {
      //echo cancellation is used to cancel the echo of the audio
      echoCancellation: true,
      //noise suppression is used to suppress the noise of the audio
      noiseSuppression: true,
    },
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    }
  }

  Logger.debug('STREAM', 'Media constraints configured', complexConstraints);
  Logger.info('STREAM', 'Requesting user media access...');

  try {
    const stream = await navigator.mediaDevices.getUserMedia(complexConstraints);
    
    Logger.info('STREAM', 'User media access granted', {
      audioTracks: stream.getAudioTracks().length,
      videoTracks: stream.getVideoTracks().length,
      trackIds: stream.getTracks().map(track => ({
        kind: track.kind,
        id: track.id,
        enabled: track.enabled,
        muted: track.muted
      }))
    });
    
    localVideo = document.getElementById('mainVideo');
    if (!localVideo) {
      throw new Error('Main video element not found in DOM');
    }
    
    localVideo.srcObject = stream;
    localStream = stream;
    
    // Update state
    AppState.updateState({ localStreamState: 'active' });
    
    Logger.info('STREAM', 'Local video stream attached to DOM element');
    
    // Initialize WebSocket connection after local stream is ready
    Logger.info('STREAM', 'Local stream ready, initializing WebSocket connection');
    InitializeSocketConnection();
    
  } catch (err) {
    Logger.error('STREAM', 'Failed to access user media devices', err, {
      constraints: complexConstraints,
      errorName: err.name,
      errorMessage: err.message
    });
    
    AppState.updateState({ localStreamState: 'failed' });
    
    // Show user-friendly error message
    alert(`Failed to access camera/microphone: ${err.message}`);
  }
}

function addRemoteVideo(peerId, stream, participantName = 'Unknown') {
    Logger.info('REMOTE', 'Adding remote video participant', {
      peerId,
      participantName,
      streamTracks: stream.getTracks().length,
      existingVideoElements: remoteVideoElements.size
    });
    
    let videoElement = remoteVideoElements.get(peerId);
    if (!videoElement) {
        Logger.debug('REMOTE', 'Creating new video element for participant', { peerId, participantName });
        
        // Create participant video container that matches the existing design
        const videoContainer = document.createElement('div');
        videoContainer.className = 'participant-video';
        videoContainer.id = `participant-${peerId}`;
        
        // Create video element
        videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.className = 'w-full h-full object-cover';
        
        // Create participant info overlay
        const participantInfo = document.createElement('div');
        participantInfo.className = 'absolute bottom-2 left-2';
        participantInfo.innerHTML = `<h4 class="text-sm font-medium">${participantName}</h4>`;
        
        videoContainer.appendChild(videoElement);
        videoContainer.appendChild(participantInfo);
        
        // Add to video grid
        const videoGrid = document.getElementById('videoGrid');
        if (!videoGrid) {
            Logger.error('REMOTE', 'Video grid element not found in DOM');
            return;
        }
        
        videoGrid.appendChild(videoContainer);
        
        remoteVideoElements.set(peerId, videoElement);
        
        // Add to participants list
        addParticipantToList(peerId, participantName);
        
        // Update participant count
        updateParticipantCount();
        
        Logger.info('REMOTE', 'Remote video element created and added to DOM', {
          peerId,
          participantName,
          totalRemoteVideos: remoteVideoElements.size
        });
    } else {
        Logger.debug('REMOTE', 'Updating existing video element', { peerId, participantName });
    }
    
    videoElement.srcObject = stream;
    
    // Add to global state
    AppState.remoteParticipants.set(peerId, { name: participantName, stream });
}

function removeRemoteVideo(peerId) {
    Logger.info('REMOTE', 'Removing remote video participant', { peerId });
    
    const videoElement = remoteVideoElements.get(peerId);
    if (videoElement) {
        const videoContainer = videoElement.closest('.participant-video');
        if (videoContainer) {
            videoContainer.remove();
            Logger.debug('REMOTE', 'Video container removed from DOM', { peerId });
        }
        remoteVideoElements.delete(peerId);
        removeParticipantFromList(peerId);
        updateParticipantCount();
        
        // Remove from global state
        AppState.remoteParticipants.delete(peerId);
        
        Logger.info('REMOTE', 'Remote video participant removed', {
          peerId,
          remainingParticipants: remoteVideoElements.size
        });
    } else {
        Logger.warn('REMOTE', 'Attempted to remove non-existent remote video', { peerId });
    }
}

function addParticipantToList(peerId, name) {
    if (remoteParticipants.has(peerId)) {
        Logger.debug('PARTICIPANTS', 'Participant already in list, skipping', { peerId, name });
        return;
    }
    
    Logger.info('PARTICIPANTS', 'Adding participant to list', { peerId, name });
    
    const participantsList = document.getElementById('participantsList');
    if (!participantsList) {
        Logger.error('PARTICIPANTS', 'Participants list element not found in DOM');
        return;
    }
    
    const participantElement = document.createElement('div');
    participantElement.className = 'flex items-center justify-between p-3 bg-gray-700 rounded-lg';
    participantElement.id = `participant-list-${peerId}`;
    
    const firstLetter = name.charAt(0).toUpperCase();
    const randomColor = `bg-${['blue', 'green', 'purple', 'red', 'yellow'][Math.floor(Math.random() * 5)]}-600`;
    
    participantElement.innerHTML = `
        <div class="flex items-center space-x-3">
            <div class="w-10 h-10 ${randomColor} rounded-full flex items-center justify-center">
                <span class="text-sm font-medium">${firstLetter}</span>
            </div>
            <div>
                <h4 class="font-medium text-sm">${name}</h4>
                <p class="text-xs text-gray-400">Participant</p>
            </div>
        </div>
        <div class="flex items-center space-x-2">
            <i class="fas fa-microphone text-green-500"></i>
            <i class="fas fa-video text-green-500"></i>
        </div>
    `;
    
    participantsList.appendChild(participantElement);
    remoteParticipants.set(peerId, { name, element: participantElement });
    
    Logger.debug('PARTICIPANTS', 'Participant added to list successfully', {
      peerId,
      name,
      totalParticipants: remoteParticipants.size
    });
}

function removeParticipantFromList(peerId) {
    const participant = remoteParticipants.get(peerId);
    if (participant) {
        participant.element.remove();
        remoteParticipants.delete(peerId);
        Logger.debug('PARTICIPANTS', 'Participant removed from list', { peerId });
    } else {
        Logger.warn('PARTICIPANTS', 'Attempted to remove non-existent participant from list', { peerId });
    }
}

function updateParticipantCount() {
    const count = 1 + remoteParticipants.size; // 1 for local user + remote participants
    const participantCountElement = document.getElementById('participantCount');
    if (participantCountElement) {
        participantCountElement.textContent = count.toString();
        Logger.debug('PARTICIPANTS', 'Participant count updated', { count });
    } else {
        Logger.warn('PARTICIPANTS', 'Participant count element not found in DOM');
    }
}

Logger.info('SIGNALING', 'Signaling server URL from session storage', {
  assignedSignalingServerUrl: sessionStorage.getItem('assignedSignalingServerUrl')
});

function sendMessage(type, payload) {
  Logger.debug('SIGNALING', 'Preparing to send message', { type, payload });
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    const message = { 
      type: type, 
      payload: payload,
      senderId: user.id,
      meetingId: meetingID
    };

    Logger.info('SIGNALING', 'Sending message to signaling server', message);
    
    try {
      ws.send(JSON.stringify(message));
      Logger.debug('SIGNALING', 'Message sent successfully', { type, messageSize: JSON.stringify(message).length });
    } catch (error) {
      Logger.error('SIGNALING', 'Failed to send message', error, { type, payload });
    }
  } else {
    Logger.error('SIGNALING', 'WebSocket not connected or not open', null, {
      wsExists: !!ws,
      wsReadyState: ws ? ws.readyState : 'null',
      wsReadyStateText: ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState] : 'null'
    });
  }
}

let peerConnection = null;
let RemoteIceCandidates = [];
const stunServers = [{ urls: 'stun:stun.l.google.com:19302' }]; // Google's public STUN server

function createPeerConnection() {
    Logger.info('WEBRTC', 'Creating new PeerConnection', {
      stunServers,
      localStreamTracks: localStream ? localStream.getTracks().length : 0
    });

    try {
        peerConnection = new RTCPeerConnection({iceServers: stunServers});
        Logger.info('WEBRTC', 'PeerConnection created successfully');

        //for each track in the local stream, add it to the peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                //add the track to the peer connection and link it to the local stream
                peerConnection.addTrack(track, localStream);
                Logger.debug('WEBRTC', 'Local track added to PeerConnection', {
                  trackKind: track.kind,
                  trackId: track.id,
                  trackEnabled: track.enabled
                });
            });
            Logger.info('WEBRTC', 'All local stream tracks added to PeerConnection');
        } else {
            Logger.warn('WEBRTC', 'No local stream available when creating PeerConnection');
        }

        //review for ways to recieve ice candidates to see if you can start mining(receive/send)
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                Logger.debug('WEBRTC', 'ICE candidate generated', {
                  candidateType: event.candidate.type,
                  candidateProtocol: event.candidate.protocol,
                  candidateAddress: event.candidate.address
                });
                sendMessage('candidate', { candidate: event.candidate , clientID: user.id, meetingID: meetingID});
            } else {
                Logger.info('WEBRTC', 'ICE candidate gathering complete');
            }
        };

        peerConnection.ontrack = (event) => {
            Logger.info('WEBRTC', 'Remote track received', {
              trackKind: event.track.kind,
              trackId: event.track.id,
              streamId: event.streams[0]?.id
            });
            
            const remoteStream = event.streams[0];
            if (remoteStream) {
                // Use a more reliable way to identify remote peers
                // The SFU should send participant information
                const remotePeerId = event.track.id || `peer-${Date.now()}`;
                // Try to get participant name from the track metadata or use a default
                const participantName = event.track.label || `Participant ${remotePeerId.slice(0, 8)}`;
                addRemoteVideo(remotePeerId, remoteStream, participantName);
            } else {
                Logger.warn('WEBRTC', 'Remote track received but no stream available');
            }
        };

        peerConnection.onconnectionstatechange = () => {
            const newState = peerConnection.connectionState;
            Logger.info('WEBRTC', 'PeerConnection state changed', {
              previousState: AppState.peerConnectionState,
              newState: newState
            });
            
            AppState.updateState({ peerConnectionState: newState });
            
            if (newState === 'disconnected' || newState === 'failed' || newState === 'closed') {
                Logger.warn('WEBRTC', 'PeerConnection disconnected or failed, cleaning up');
                cleanupWebRTC();
            }
        };

        peerConnection.onnegotiationneeded = async () => {
            Logger.info('WEBRTC', 'Negotiation needed, creating offer');
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                Logger.info('WEBRTC', 'Local description set, sending offer to signaling server');
                sendMessage('offer', { sdp: offer.sdp });
                Logger.info('WEBRTC', 'Offer sent to SFU successfully');
            } catch (error) {
                Logger.error('WEBRTC', 'Error creating or sending offer', error);
            }
        };

        Logger.info('WEBRTC', 'PeerConnection event handlers configured successfully');
        
    } catch (error) {
        Logger.error('WEBRTC', 'Failed to create PeerConnection', error);
        throw error;
    }
}

async function handleSignalingMessage(message) {
    Logger.debug('SIGNALING', 'Processing signaling message', {
      type: message.type,
      hasPayload: !!message.payload
    });

    try {
        // For WebRTC messages, we need a PeerConnection
        if ((message.type === 'answer' || message.type === 'offer' || message.type === 'candidate') && !peerConnection) {
            Logger.warn('SIGNALING', 'PeerConnection not initialized, ignoring WebRTC message', {
                type: message.type
            });
            return;
        }

        if (message.type === 'answer') {
            Logger.info('SIGNALING', 'Received answer from SFU', {
              payload: message.payload,
              payloadType: typeof message.payload,
              hasType: !!message.payload?.type,
              hasSdp: !!message.payload?.sdp
            });
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
            Logger.info('SIGNALING', 'Remote description set from answer');
            
            // Process any buffered ICE candidates
            while (RemoteIceCandidates.length > 0) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(RemoteIceCandidates.shift()));
            }
            Logger.info('SIGNALING', 'Processed buffered ICE candidates', { count: RemoteIceCandidates.length });
        } else if (message.type === 'offer') {
            Logger.info('SIGNALING', 'Received renegotiation offer from SFU');
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            while (RemoteIceCandidates.length > 0) {
              await peerConnection.addIceCandidate(new RTCIceCandidate(RemoteIceCandidates.shift()));
            }
            sendMessage('answer', { sdp: answer.sdp });
            Logger.info('SIGNALING', 'Renegotiation answer sent to SFU');
        } else if (message.type === 'candidate') {
            Logger.debug('SIGNALING', 'Received ICE candidate from SFU');
            try {
                // **ICE Candidate Exchange**
                // Add the received candidate to our PeerConnection.
                // The WebRTC engine will then use this candidate to try and establish a connection.

                if (peerConnection && peerConnection.remoteDescription) {
                  await peerConnection.addIceCandidate(new RTCIceCandidate(message.payload));
                } else {
                  RemoteIceCandidates.push(message.payload);
                  Logger.debug('SIGNALING', 'ICE candidate buffered', { 
                    bufferedCount: RemoteIceCandidates.length,
                    hasPeerConnection: !!peerConnection,
                    hasRemoteDescription: !!(peerConnection && peerConnection.remoteDescription)
                  });
                }
                Logger.debug('SIGNALING', 'ICE candidate added to PeerConnection');
            } catch (e) {

                Logger.error('SIGNALING', 'Error adding received ICE candidate', e, {
                  payload: message.payload
                });
            }
        } else if (message.type === 'chat') {
            Logger.info('SIGNALING', 'Received chat message', {
              senderId: message.payload.senderId,
              messageLength: message.payload.message?.length
            });
            // Don't display our own messages twice
            if (message.payload.senderId !== user.id) {
                addChatMessageToDisplay(message.payload);
            }
        } else if (message.type === 'meetingEvent') {
            Logger.info('SIGNALING', 'Received meeting event', {
              eventType: message.payload.type,
              clientId: message.payload.payload?.clientId
            });
            
            if (message.payload.type === 'clientLeft') {
                const clientId = message.payload.payload.clientId;
                Logger.info('SIGNALING', 'Client left meeting, cleaning up remote video', { clientId });
                removeRemoteVideo(clientId);
            } else if (message.payload.type === 'clientJoined') {
                const clientId = message.payload.payload.clientId;
                const clientName = message.payload.payload.name || `Participant ${clientId.slice(0, 8)}`;
                Logger.info('SIGNALING', 'Client joined meeting', { clientId, clientName });
                // Don't add video here - it will be added when we receive the track
            }
        } else if (message.type === 'meetingJoined') {
            Logger.info('SIGNALING', 'Meeting joined confirmation received', {
              meetingId: message.payload.meetingId,
              success: message.payload.success
            });
            
            // Now that we've confirmed we're in the meeting, create the PeerConnection
            if (message.payload.success) {
                Logger.info('SIGNALING', 'Creating PeerConnection after meeting confirmation');
                createPeerConnection();
            }
        } else if (message.type === 'error') {
            Logger.error('SIGNALING', 'Signaling error from server', null, {
              errorMessage: message.payload.message
            });
            alert('Server Error: ' + message.payload.message);
        } else {
            Logger.warn('SIGNALING', 'Unknown message type received', null, {
              type: message.type,
              payload: message.payload
            });
        }
    } catch (error) {
        Logger.error('SIGNALING', 'Error handling signaling message', error, {
          messageType: message.type,
          messagePayload: message.payload
        });
    }
}

function InitializeSocketConnection() {
  Logger.info('WEBSOCKET', 'Initializing WebSocket connection');
  
  let signalingUrl = sessionStorage.getItem('assignedSignalingServerUrl');
  if (!signalingUrl) {
    Logger.warn('WEBSOCKET', 'No signaling server URL found in session storage, using default');
    signalingUrl = 'ws://localhost:8080';
  }
  
  Logger.info('WEBSOCKET', 'WebSocket creation initiated', { signalingUrl });

  try {
    ws = new WebSocket(signalingUrl);
    
    ws.onopen = () => {
      Logger.info('WEBSOCKET', 'Connected to signaling server', {
        url: signalingUrl,
        readyState: ws.readyState
      });
      
      AppState.updateState({ connectionState: 'connected' });
      
      // Register client with signaling server (this tells THIS signaling server who we are)
      sendMessage('register', { id: user.id, role: 'client' });
      // Join the specific meeting (this tells THIS signaling server about our meeting context)
      sendMessage('joinMeeting', { meetingId: meetingID });
      // Create PeerConnection after local stream and WS are ready

      
      // Display connection status
      const connectionStatus = {
        signalingServer: signalingUrl,
        meetingId: meetingID,
        userId: user.id,
        peerConnectionState: peerConnection ? peerConnection.connectionState : 'not created'
      };
      
      Logger.info('WEBSOCKET', 'Connection status', connectionStatus);
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        Logger.debug('WEBSOCKET', 'Received message from signaling server', {
          messageType: message.type,
          messageSize: event.data.length,
          messagePayload: message.payload
        });
        handleSignalingMessage(message);
      } catch (error) {
        Logger.error('WEBSOCKET', 'Failed to parse received message', error, {
          rawData: event.data
        });
      }
    };
    
    ws.onclose = (event) => {
      Logger.info('WEBSOCKET', 'Disconnected from signaling server', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });
      
      AppState.updateState({ connectionState: 'disconnected' });
      cleanupWebRTC();
    }
    
    ws.onerror = (error) => {
      Logger.error('WEBSOCKET', 'WebSocket error occurred', error);
      AppState.updateState({ connectionState: 'error' });
    }
    
    Logger.info('WEBSOCKET', 'WebSocket event handlers configured');
    
  } catch (error) {
    Logger.error('WEBSOCKET', 'Failed to create WebSocket connection', error, {
      signalingUrl
    });
  }
}

// Remove the duplicate WebSocket handler and PeerConnection that were causing conflicts

function closeStream() {
    Logger.info('STREAM', 'Closing stream and cleaning up meeting');
    
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
        
        Logger.info('STREAM', 'UI elements reset for stream closure');
      
        if (ws && ws.readyState === WebSocket.OPEN) {
          Logger.info('STREAM', 'Sending leave meeting message and closing WebSocket');
          sendMessage('leaveMeeting', { meetingId: meetingID });
          ws.close();
        } else {
          Logger.info('STREAM', 'WebSocket not available, cleaning up WebRTC directly');
          cleanupWebRTC();
        }
    } catch (error) {
        Logger.error('STREAM', 'Error during stream closure', error);
    }
}

async function copyMeetingId() {
    Logger.debug('UI', 'Copy meeting ID action initiated');
    
    const meetingIdElement = document.getElementById('meetingId');
    const copyButton = document.getElementById('copyMeetingIdBtn');
    const copyIcon = copyButton.querySelector('i');
    
    // Extract the meeting ID from the text (remove "ID: " prefix)
    const meetingIdText = meetingIdElement.textContent;
    const meetingId = meetingIdText.replace('ID: ', '');
    
    if (meetingId === 'Loading...') {
      Logger.warn('UI', 'Attempted to copy meeting ID while still loading');
      return; // Don't copy if still loading
    }
    
    try {
      // Copy to clipboard
      await navigator.clipboard.writeText(meetingId);
      
      Logger.info('UI', 'Meeting ID copied to clipboard successfully', { meetingId });
      
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
        Logger.debug('UI', 'Copy button reset to original state');
      }, 2000);
      
    } catch (err) {
      Logger.error('UI', 'Failed to copy meeting ID using clipboard API', err, { meetingId });
      
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = meetingId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        Logger.info('UI', 'Meeting ID copied using fallback method', { meetingId });
        
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
        Logger.error('UI', 'Fallback copy method also failed', fallbackError, { meetingId });
      }
    }
}

function cleanupWebRTC() {
  Logger.info('CLEANUP', 'Starting WebRTC cleanup');
  
  try {
    if (localStream) {
      const trackCount = localStream.getTracks().length;
      localStream.getTracks().forEach(track => {
        Logger.debug('CLEANUP', 'Stopping local track', {
          trackKind: track.kind,
          trackId: track.id
        });
        track.stop();
      });
      localStream = null;
      Logger.info('CLEANUP', 'Local stream tracks stopped', { trackCount });
    }
    
    if (localVideo) {
      localVideo.srcObject = null;
      Logger.debug('CLEANUP', 'Local video element cleared');
    }
    
    if (peerConnection) {
      const previousState = peerConnection.connectionState;
      peerConnection.close();
      peerConnection = null;
      Logger.info('CLEANUP', 'PeerConnection closed', { previousState });
    }
    
    const remoteVideoCount = remoteVideoElements.size;
    remoteVideoElements.forEach(video => {
      const container = video.closest('.participant-video');
      if (container) {
        container.remove();
      }
    });
    remoteVideoElements.clear();
    remoteParticipants.clear();
    
    Logger.info('CLEANUP', 'WebRTC resources cleaned up', {
      remoteVideosRemoved: remoteVideoCount,
      participantsCleared: remoteParticipants.size
    });
    
    AppState.updateState({ 
      localStreamState: 'cleaned',
      peerConnectionState: 'closed',
      connectionState: 'disconnected'
    });
    
  } catch (error) {
    Logger.error('CLEANUP', 'Error during WebRTC cleanup', error);
  }
}

//get the screen stream
async function getSharedScreenStream() {
  Logger.info('SCREEN', 'Requesting screen sharing sources');
  
  try {
    console.log("Requesting sources...");
    const sources = await window.electronAPI.getScreenSources();
    Logger.info('SCREEN', 'Screen sources retrieved', {
      sourceCount: sources.length,
      sources: sources.map(s => ({ id: s.id, name: s.name, thumbnail: !!s.thumbnail }))
    });

    const source = sources[1];
    if (!source) {
      throw new Error('No screen source available');
    }

    Logger.info('SCREEN', 'Selected screen source', { sourceId: source.id, sourceName: source.name });

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
        }
      }
    });

    Logger.info('SCREEN', 'Screen sharing stream obtained', {
      videoTracks: stream.getVideoTracks().length,
      audioTracks: stream.getAudioTracks().length
    });

    const video = document.getElementById('screenVideo');
    video.srcObject = stream;
    video.play();
    
    Logger.info('SCREEN', 'Screen sharing video attached to DOM');
    
  } catch (err) {
    Logger.error('SCREEN', 'Error accessing screen stream', err);
  }
}

function setupChatHandlers() {
  Logger.info('CHAT', 'Setting up chat input handlers');
  
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    // Handle Enter key press
    chatInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        Logger.debug('CHAT', 'Enter key pressed, sending message');
        sendChatMessage();
      }
    });
    
    // Handle send button click
    const sendButton = document.querySelector('button[onclick="sendMessage()"]');
    if (sendButton) {
      sendButton.onclick = sendChatMessage;
      Logger.debug('CHAT', 'Send button click handler attached');
    } else {
      Logger.warn('CHAT', 'Send button not found in DOM');
    }
    
    Logger.info('CHAT', 'Chat input handlers configured successfully');
  } else {
    Logger.error('CHAT', 'Chat input element not found in DOM');
  }
}

function sendChatMessage() {
  const chatInput = document.getElementById('chatInput');
  const message = chatInput.value.trim();
  
  if (!message) {
    Logger.debug('CHAT', 'Empty message, ignoring send request');
    return;
  }
  
  Logger.info('CHAT', 'Sending chat message', { messageLength: message.length });
  
  // Create message object
  const chatMessage = {
    id: generateMessageId(),
    senderId: user.id,
    senderName: user.name || user.email || 'You',
    message: message,
    timestamp: new Date().toISOString(),
    type: 'chat'
  };
  
  // Send to signaling server
  sendMessage('chat', chatMessage);
  
  // Add to local chat display
  addChatMessageToDisplay(chatMessage);
  
  // Clear input
  chatInput.value = '';
  
  Logger.debug('CHAT', 'Chat message sent and displayed locally', {
    messageId: chatMessage.id,
    senderName: chatMessage.senderName
  });
}

function addChatMessageToDisplay(messageData) {
  Logger.debug('CHAT', 'Adding chat message to display', {
    messageId: messageData.id,
    senderId: messageData.senderId,
    isOwnMessage: messageData.senderId === user.id
  });
  
  const chatMessagesContainer = document.getElementById('chatMessages');
  if (!chatMessagesContainer) {
    Logger.error('CHAT', 'Chat messages container not found in DOM');
    return;
  }
  
  const messageElement = document.createElement('div');
  messageElement.className = 'chat-message';
  messageElement.id = `message-${messageData.id}`;
  
  const isOwnMessage = messageData.senderId === user.id;
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
        <p class="text-sm text-gray-300 mt-1">${escapeHtml(messageData.message)}</p>
      </div>
    </div>
  `;
  
  chatMessagesContainer.appendChild(messageElement);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
  
  // Store message in local array
  chatMessages.push(messageData);
  AppState.chatMessages = chatMessages;
  
  Logger.debug('CHAT', 'Chat message added to display', {
    messageId: messageData.id,
    totalMessages: chatMessages.length
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function generateMessageId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Export logging utilities for debugging
window.Logger = Logger;
window.AppState = AppState;

// // Make Logger and AppState globally accessible for debugging
// window.Logger = Logger;
// window.AppState = AppState;

// Add helper functions for debugging
window.debugClient = {
  // Show current app state
  showState: () => {
    console.log('📊 Current App State:', AppState.getState());
    return AppState.getState();
  },
  
  // Show logger stats
  showLoggerStats: () => {
    console.log('📊 Logger Level:', Logger.currentLevel);
    console.log('📊 Available Levels:', Logger.levels);
    return { level: Logger.currentLevel, levels: Logger.levels };
  },
  
  // Set logger level
  setLogLevel: (level) => {
    if (Logger.levels[level] !== undefined) {
      Logger.currentLevel = Logger.levels[level];
      console.log(`📊 Logger level set to: ${level}`);
      return true;
    } else {
      console.error(`❌ Invalid log level: ${level}. Available: ${Object.keys(Logger.levels).join(', ')}`);
      return false;
    }
  },
  
  // Test all log levels
  testLogs: () => {
    console.log('🧪 Testing all log levels...');
    Logger.debug('DEBUG_TEST', 'This is a debug message', { test: true });
    Logger.info('INFO_TEST', 'This is an info message', { test: true });
    Logger.warn('WARN_TEST', 'This is a warning message', { test: true });
    Logger.error('ERROR_TEST', 'This is an error message', new Error('Test error'), { test: true });
  }
};

console.log('🔧 Debug helpers available: window.debugClient.showState(), window.debugClient.testLogs(), etc.');

// Log initial application state
Logger.info('APP', 'Application initialized', AppState.getState());

