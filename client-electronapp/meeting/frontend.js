const signalingServerUrl = 'ws://localhost:8080';
const stunServers = [{ urls: 'stun:stun.l.google.com:19302' }]; // Google's public STUN server



const localVideo = document.getElementById('mainVideo');
const remoteVideosContainer = document.getElementById('remoteVideosContainer');
const joinButton = document.getElementById('joinButton');
const leaveButton = document.getElementById('leaveButton');
const meetingIdInput = document.getElementById('meetingIdInput');
const clientIdDisplay = document.getElementById('clientIdDisplay');
const currentMeetingIdDisplay = document.getElementById('currentMeetingIdDisplay');
const signalingServerDisplay = document.getElementById('signalingServerDisplay');
const sfuIdDisplay = document.getElementById('sfuIdDisplay');


let ws; // WebSocket connection to signaling server
let localStream;
let peerConnection; // RTCPeerConnection for the local client to SFU
let clientId = generateUniqueId(); // Unique ID for this client
let currentMeetingId = null;
let assignedSignalingServerUrl = null;
let assignedSfuId = null;


const remoteVideoElements = new Map(); // Map<peerId, videoElement>

clientIdDisplay.textContent = clientId;

// Set meeting ID from URL parameters
const urlParams = new URLSearchParams(window.location.search);
const meetingIdFromUrl = urlParams.get('meetingId') || urlParams.get('meetingID');
if (meetingIdFromUrl) {
    document.getElementById('meetingId').textContent = `ID: ${meetingIdFromUrl}`;
}

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
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localVideo.srcObject = stream;
        })
        .catch(err => {
            console.error('Error accessing webcam/microphone:', err);
        })  ;
        // localVideo.srcObject = localStream;
        console.log('Local stream started.');
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Could not access camera/microphone. Please ensure permissions are granted.');
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection({ iceServers: stunServers });

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // **ICE Candidate Gathering**
    peerConnection.onicecandidate = (event) => {
        // This event fires whenever the browser's ICE agent discovers a new potential network path (candidate).
        // It could be a local IP, a public IP via STUN, or a relay IP via TURN.
        if (event.candidate) {
            console.log('Generated ICE candidate:', event.candidate);
            // Send this candidate to the remote peer (SFU) via the signaling server.
            // The signaling server acts as a relay.
            sendMessage('candidate', { candidate: event.candidate });
        } else {
            // event.candidate is null, indicating that ICE gathering is complete.
            console.log('ICE candidate gathering complete.');
        }
    };

    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event.track);
        const remoteStream = event.streams[0];
        if (remoteStream) {
            // Use a more reliable way to identify remote peers
            // The SFU should send participant information
            const remotePeerId = event.track.id || `peer-${Date.now()}`;
            addRemoteVideo(remotePeerId, remoteStream);
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
    } else if (message.type === 'offer') {
        console.log('Received renegotiation offer from SFU.');
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            sendMessage('answer', { sdp: answer.sdp, type: 'answer' });
            console.log('Sent renegotiation answer to SFU.');
        } catch (error) {
            console.error('Error handling renegotiation offer:', error);
        }
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
    } else if (message.type === 'meetingEvent') {
        console.log('Received meeting event:', message.payload);
        if (message.payload.type === 'clientJoined') {
            console.log(`Client ${message.payload.payload.clientId} joined the meeting.`);
        } else if (message.payload.type === 'clientLeft') {
            console.log(`Client ${message.payload.payload.clientId} left the meeting.`);
            // Remove the video for this client
            removeRemoteVideo(message.payload.payload.clientId);
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
    const urlParams = new URLSearchParams(window.location.search);

    const meetingId = urlParams.get('meetingId') || urlParams.get('meetingID');
    if (!meetingId) {
        alert('Please enter a Meeting ID.');
        console.error('No meeting ID found in URL.');
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

    assignedSignalingServerUrl = sessionStorage.getItem('assignedSignalingServerUrl');
    assignedSfuId = sessionStorage.getItem('assignedSfuId');

    // Use the assigned signaling server URL, fallback to default if not set
    if (!assignedSignalingServerUrl) {
        assignedSignalingServerUrl = signalingServerUrl;
    }


    signalingServerDisplay.textContent = assignedSignalingServerUrl;
    sfuIdDisplay.textContent = assignedSfuId;

    console.info(`Assigned Signaling Server: ${assignedSignalingServerUrl}`);
    console.info(`Assigned SFU: ${assignedSfuId}`);




    // 3. Initialize WebSocket connection to the assigned signaling server
    ws = new WebSocket(assignedSignalingServerUrl);

    ws.onopen = () => {
        console.info('Connected to signaling server:', assignedSignalingServerUrl);
        // Register client with signaling server (this tells THIS signaling server who we are)
        sendMessage('register', { id: clientId, role: 'client' });
        // Join the specific meeting (this tells THIS signaling server about our meeting context)
        sendMessage('joinMeeting', { meetingId: currentMeetingId });
        // 4. Create PeerConnection after local stream and WS are ready
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
        signalingServerDisplay.textContent = 'N/A';
        sfuIdDisplay.textContent = 'N/A';
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
        signalingServerDisplay.textContent = 'N/A';
        sfuIdDisplay.textContent = 'N/A';
    }
};

// Initial state
joinButton.disabled = false;
leaveButton.disabled = true;
meetingIdInput.disabled = false;

