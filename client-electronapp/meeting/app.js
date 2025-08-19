const SIGNAL_SERVER = "ws://localhost:8080?userId=user123";
const SFU_URL = "http://localhost:8443/offer";

const socket = new WebSocket(SIGNAL_SERVER);
const pc = new RTCPeerConnection({
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
});

async function getLocalMedia() {
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    };
  
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      document.getElementById("localVideo").srcObject = stream;
  
      return stream;
    } catch (err) {
      console.error("Error accessing media devices:", err);
      alert("Could not access camera or microphone.");
      return null;
    }
  }
  

// Add webcam + mic
async function start() {
    const stream = await getLocalMedia();
    if (!stream) return;
  
    // Add video track with simulcast (optional)
    const videoTrack = stream.getVideoTracks()[0];
    pc.addTransceiver(videoTrack, {
      direction: "sendonly",
      sendEncodings: [
        { rid: "low", scaleResolutionDownBy: 4, maxBitrate: 150000 },
        { rid: "med", scaleResolutionDownBy: 2, maxBitrate: 500000 },
        { rid: "hi", scaleResolutionDownBy: 1, maxBitrate: 1200000 }
      ]
    });
  
    // Add audio track
    stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
  
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
  
    const res = await fetch("http://localhost:8443/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(offer)
    });
  
    const answer = await res.json();
    await pc.setRemoteDescription(answer);
  }
  

socket.addEventListener("open", () => {
  console.log("Connected to signaling server");
  socket.send(JSON.stringify({ type: "join", roomId: "testroom" }));
  start();
});
