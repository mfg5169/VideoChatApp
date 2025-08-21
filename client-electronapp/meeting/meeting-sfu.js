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
console.log("URL Params: ", urlParams);
const meetingID = urlParams.get('meetingID') || 'DEMO-123';
const meetingName = sessionStorage.getItem('meetingName') || 'DEMO-123';
const user = JSON.parse(localStorage.getItem('userData'));

// Remote participants management
let remoteVideoElements = new Map();
let remoteParticipants = new Map();

// Chat message handling
let chatMessages = [];

// Initialize meeting
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('meetingId').textContent = `ID: ${meetingID}`;
  document.getElementById('meetingTitle').textContent = `Meeting ${meetingName}`;
  
  // Initialize video streams
  initializeVideoStreams();
  
  // Set up chat input event listeners
  setupChatHandlers();
});

async function initializeVideoStreams() {
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

  localStream = await navigator.mediaDevices.getUserMedia(complexConstraints)
    .then(stream => {
      localVideo = document.getElementById('mainVideo');
      localVideo.srcObject = stream;
      // Initialize WebSocket connection after local stream is ready
      InitializeSocketConnection();
    })
    .catch(err => {
      console.error('Error accessing webcam/microphone:', err);
    });
}

function addRemoteVideo(peerId, stream, participantName = 'Unknown') {
    let videoElement = remoteVideoElements.get(peerId);
    if (!videoElement) {
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
        videoGrid.appendChild(videoContainer);
        
        remoteVideoElements.set(peerId, videoElement);
        
        // Add to participants list
        addParticipantToList(peerId, participantName);
        
        // Update participant count
        updateParticipantCount();
    }
    videoElement.srcObject = stream;
}

function removeRemoteVideo(peerId) {
    const videoElement = remoteVideoElements.get(peerId);
    if (videoElement) {
        const videoContainer = videoElement.closest('.participant-video');
        if (videoContainer) {
            videoContainer.remove();
        }
        remoteVideoElements.delete(peerId);
        removeParticipantFromList(peerId);
        updateParticipantCount();
        console.log(`Removed video for peer: ${peerId}`);
    }
}

function addParticipantToList(peerId, name) {
    if (remoteParticipants.has(peerId)) return;
    
    const participantsList = document.getElementById('participantsList');
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
}

function removeParticipantFromList(peerId) {
    const participant = remoteParticipants.get(peerId);
    if (participant) {
        participant.element.remove();
        remoteParticipants.delete(peerId);
    }
}

function updateParticipantCount() {
    const count = 1 + remoteParticipants.size; // 1 for local user + remote participants
    const participantCountElement = document.getElementById('participantCount');
    if (participantCountElement) {
        participantCountElement.textContent = count.toString();
    }
}

console.log("Session Storage assignedSignalingServerUrl: ", sessionStorage.getItem('assignedSignalingServerUrl'));

function sendMessage(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ 
      type: type, 
      payload: payload,
      senderId: user.id,
      meetingId: meetingID
    }));
  } else {
    console.error('WebSocket not connected or not open.');
  }
}

let peerConnection = null;
const stunServers = [{ urls: 'stun:stun.l.google.com:19302' }]; // Google's public STUN server

function createPeerConnection() {
    peerConnection = new RTCPeerConnection({iceServers: stunServers});

    //for each track in the local stream, add it to the peer connection
    localStream.getTracks().forEach(track => {
        //add the track to the peer connection and link it to the local stream
        peerConnection.addTrack(track, localStream);
    });

    //review for ways to recieve ice candidates to see if you can start mining(receive/send)
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage('candidate', { candidate: event.candidate , clientID: user.id, meetingID: meetingID});
        }
        else{
            console.log('ICE candidate gathering complete.');
        }
    };
    
    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track);
        const remoteStream = event.streams[0];
        if (remoteStream) {
            const remotePeerId = event.track.id;
            // Try to get participant name from the track metadata or use a default
            const participantName = event.track.label || `Participant ${remotePeerId.slice(0, 8)}`;
            addRemoteVideo(remotePeerId, remoteStream, participantName);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('PeerConnection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
            console.warn('PeerConnection disconnected or failed. Attempting to clean up.');
            cleanupWebRTC();
        }
    };

    peerConnection.onnegotiationneeded = async () => {
        console.log('Negotiation needed. Creating offer...');
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            sendMessage('offer', { sdp: offer.sdp });
            console.log('Sent offer to SFU.');
        } catch (error) {
            console.error('Error creating or sending offer:', error);
        }
    };
}

async function handleSignalingMessage(message) {
    if (!peerConnection) {
        console.warn('PeerConnection not initialized. Ignoring signaling message.');
        return;
    }

    if (message.type === 'answer') {
        console.log('Received answer from SFU.');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
    } else if (message.type === 'candidate') {
        console.log('Received ICE candidate from SFU.');
        try {
            // **ICE Candidate Exchange**
            // Add the received candidate to our PeerConnection.
            // The WebRTC engine will then use this candidate to try and establish a connection.
            await peerConnection.addIceCandidate(new RTCIceCandidate(message.payload.candidate));
        } catch (e) {
            console.error('Error adding received ICE candidate:', e);
        }
    } else if (message.type === 'chat') {
        console.log('Received chat message:', message.payload);
        // Don't display our own messages twice
        if (message.payload.senderId !== user.id) {
            addChatMessageToDisplay(message.payload);
        }
    } else if (message.type === 'meetingEvent') {
        console.log('Received meeting event:', message.payload);
        if (message.payload.type === 'clientLeft') {
            const clientId = message.payload.payload.clientId;
            console.warn(`Client ${clientId} left. Cleaning up remote video.`);
            removeRemoteVideo(clientId);
        } else if (message.payload.type === 'clientJoined') {
            const clientId = message.payload.payload.clientId;
            const clientName = message.payload.payload.name || `Participant ${clientId.slice(0, 8)}`;
            console.log(`Client ${clientName} joined the meeting.`);
        }
    } else if (message.type === 'error') {
        console.error('Signaling error from server:', message.payload.message);
        alert('Server Error: ' + message.payload.message);
    }
}

function InitializeSocketConnection() {
  const signalingUrl = sessionStorage.getItem('assignedSignalingServerUrl');
  if (!signalingUrl) {
    console.error('No signaling server URL found in session storage');
    return;
  }
  
  ws = new WebSocket(signalingUrl);
  ws.onopen = () => {
    console.info('Connected to signaling server:', signalingUrl);
    // Register client with signaling server (this tells THIS signaling server who we are)
    sendMessage('register', { id: user.id, role: 'client' });
    // Join the specific meeting (this tells THIS signaling server about our meeting context)
    sendMessage('joinMeeting', { meetingId: meetingID });
    // Create PeerConnection after local stream and WS are ready
    createPeerConnection();
  };
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleSignalingMessage(message);
  };
  
  ws.onclose = () => {
    console.log('Disconnected from signaling server.');
    cleanupWebRTC();
  }
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  }
}

// Remove the duplicate WebSocket handler and PeerConnection that were causing conflicts

function closeStream() {
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
  
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendMessage('leaveMeeting', { meetingId: meetingID });
      ws.close();
    } else {
      cleanupWebRTC();
    }
}

async function copyMeetingId() {
    const meetingIdElement = document.getElementById('meetingId');
    const copyButton = document.getElementById('copyMeetingIdBtn');
    const copyIcon = copyButton.querySelector('i');
    
    // Extract the meeting ID from the text (remove "ID: " prefix)
    const meetingIdText = meetingIdElement.textContent;
    const meetingId = meetingIdText.replace('ID: ', '');
    
    if (meetingId === 'Loading...') {
      return; // Don't copy if still loading
    }
    
    try {
      // Copy to clipboard
      await navigator.clipboard.writeText(meetingId);
      
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
      }, 2000);
      
    } catch (err) {
      console.error('Failed to copy meeting ID:', err);
      
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = meetingId;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
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
    }
}

function cleanupWebRTC() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (localVideo) {
    localVideo.srcObject = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideoElements.forEach(video => video.closest('.participant-video').remove());
  remoteVideoElements.clear();
  remoteParticipants.clear();
  console.log('WebRTC resources cleaned up.');
}

//get the screen stream
async function getSharedScreenStream() {
  try {
    console.log("Requesting sources...");
    const sources = await window.electronAPI.getScreenSources();
    console.log("Sources:", sources);

    const source = sources[1];

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
        }
      }
    });

    const video = document.getElementById('screenVideo');
    video.srcObject = stream;
    video.play();
  } catch (err) {
    console.error("Error accessing screen stream:", err);
  }
}

function setupChatHandlers() {
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    // Handle Enter key press
    chatInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    
    // Handle send button click
    const sendButton = document.querySelector('button[onclick="sendMessage()"]');
    if (sendButton) {
      sendButton.onclick = sendChatMessage;
    }
  }
}

function sendChatMessage() {
  const chatInput = document.getElementById('chatInput');
  const message = chatInput.value.trim();
  
  if (!message) return;
  
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
}

function addChatMessageToDisplay(messageData) {
  const chatMessagesContainer = document.getElementById('chatMessages');
  if (!chatMessagesContainer) return;
  
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
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function generateMessageId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

