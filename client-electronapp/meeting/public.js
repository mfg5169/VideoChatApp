// public/script.js
// This is the main client-side JavaScript logic

const signalingServerUrl = 'ws://localhost:8080'; // Address of your Signaling Server
const stunServers = [{ urls: 'stun:stun.l.google.com:19302' }]; // Google's public STUN server

const localVideo = document.getElementById('localVideo');
const remoteVideosContainer = document.getElementById('remoteVideosContainer');
const joinButton = document.getElementById('joinButton');
const leaveButton = document.getElementById('leaveButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const clientIdDisplay = document.getElementById('clientIdDisplay');
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay');

let ws; // WebSocket connection to signaling server
let localStream;
let peerConnection; // RTCPeerConnection for the local client to SFU
let clientId = generateUniqueId(); // Unique ID for this client
let currentMeetingId = null;

const remoteVideoElements = new Map(); // Map<peerId, videoElement>

clientIdDisplay.textContent = clientId;

// --- Utility Functions ---
function generateUniqueId() {
    return 'client-' + Math.random().toString(36).substring(2, 9);
}

function sendMessage(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: type,
            payload: payload,
            senderId: clientId,
            meetingId: currentMeetingId
        }));
    } else {
        console.error('WebSocket not connected or not open.');
    }
}

function addRemoteVideo(peerId, stream) {
    let videoElement = remoteVideoElements.get(peerId);
    if (!videoElement) {
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'flex flex-col items-center';
        videoWrapper.innerHTML = `<h2 class="text-xl font-semibold mb-2">Peer: ${peerId}</h2>`;

        videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.className = 'rounded-lg shadow-md';
        videoWrapper.appendChild(videoElement);
        remoteVideosContainer.appendChild(videoWrapper);
        remoteVideoElements.set(peerId, videoElement);
    }
    videoElement.srcObject = stream;
}

function removeRemoteVideo(peerId) {
    const videoElement = remoteVideoElements.get(peerId);
    if (videoElement) {
        videoElement.closest('.flex-col').remove(); // Remove the wrapper div
        remoteVideoElements.delete(peerId);
        console.log(`Removed video for peer: ${peerId}`);
    }
}

// --- WebRTC Functions ---

async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        console.log('Local stream started.');
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please ensure permissions are granted.');
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection({ iceServers: stunServers });

    localStream.getTracks().forEach(track => {
        // Add tracks to the peer connection.
        // For SFU, you typically add transceivers for sending and receiving.
        // The SFU will then add its own tracks to send back.
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Generated ICE candidate:', event.candidate);
            sendMessage('candidate', { candidate: event.candidate });
        }
    };

    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track);
        // An SFU will send tracks from other participants.
        // The event.streams array contains the MediaStream objects.
        const remoteStream = event.streams[0];
        if (remoteStream) {
            // Use the track's ID or stream ID as a unique identifier for the remote video
            // In a real SFU, you'd get the original sender's ID from a signaling event.
            // For this simple demo, we'll use the remote stream ID or track ID.
            const remotePeerId = event.track.id; // Or event.streams[0].id if stream is unique per peer
            addRemoteVideo(remotePeerId, remoteStream);
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('PeerConnection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
            console.warn('PeerConnection disconnected or failed. Attempting to clean up.');
            // This might indicate SFU side issue or network problem.
            // In a real app, you'd implement re-connection logic.
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
            await peerConnection.addIceCandidate(new RTCIceCandidate(message.payload.candidate));
        } catch (e) {
            console.error('Error adding received ICE candidate:', e);
        }
    } else if (message.type === 'meetingEvent') {
        // Handle meeting-specific events (e.g., user joined/left, active speaker)
        console.log('Received meeting event:', message.payload);
        if (message.payload.type === 'clientLeft') {
            // For this simple demo, we don't have a direct mapping from SFU track ID to original client ID.
            // In a real app, the SFU would signal which specific track/stream is gone,
            // or the signaling server would provide the original client ID.
            // For now, we'll just log and let onremovetrack handle it if it fires.
            console.warn(`Client ${message.payload.payload.clientId} left. Remote video cleanup needs more robust ID mapping.`);
        }
    } else if (message.type === 'error') {
        console.error('Signaling error from server:', message.payload.message);
        alert('Server Error: ' + message.payload.message);
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
    remoteVideoElements.forEach(video => video.closest('.flex-col').remove());
    remoteVideoElements.clear();
    console.log('WebRTC resources cleaned up.');
}

// --- UI Event Handlers ---

joinButton.onclick = async () => {
    const meetingId = meetingIdInput.value.trim();
    if (!meetingId) {
        alert('Please enter a Meeting ID.');
        return;
    }

    currentMeetingId = meetingId;
    currentMeetingIdDisplay.textContent = currentMeetingId;

    joinButton.disabled = true;
    leaveButton.disabled = false;
    meetingIdInput.disabled = true;

    // 1. Start local media
    await startLocalStream();
    if (!localStream) {
        joinButton.disabled = false;
        leaveButton.disabled = true;
        meetingIdInput.disabled = false;
        return;
    }

    // 2. Initialize WebSocket connection to signaling server
    ws = new WebSocket(signalingServerUrl);

    ws.onopen = () => {
        console.log('Connected to signaling server.');
        // Register client with signaling server
        sendMessage('register', { id: clientId, role: 'client' });
        // Join the specific meeting
        sendMessage('joinMeeting', { meetingId: currentMeetingId });
        // 3. Create PeerConnection after local stream and WS are ready
        createPeerConnection();
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleSignalingMessage(message);
    };

    ws.onclose = () => {
        console.log('Disconnected from signaling server.');
        cleanupWebRTC();
        joinButton.disabled = false;
        leaveButton.disabled = true;
        meetingIdInput.disabled = false;
        currentMeetingIdDisplay.textContent = 'Not joined';
        currentMeetingId = null;
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('WebSocket connection error. Check server status.');
    };
};

leaveButton.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage('leaveMeeting', { meetingId: currentMeetingId });
        ws.close(); // This will trigger ws.onclose and cleanupWebRTC
    } else {
        cleanupWebRTC(); // Direct cleanup if WS is already closed/not open
        joinButton.disabled = false;
        leaveButton.disabled = true;
        meetingIdInput.disabled = false;
        currentMeetingIdDisplay.textContent = 'Not joined';
        currentMeetingId = null;
    }
};

// Initial state
joinButton.disabled = false;
leaveButton.disabled = true;
meetingIdInput.disabled = false;