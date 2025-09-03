const videoElement = document.getElementById('videoElement');
const ws = new WebSocket('ws://localhost:8000/ws');

ws.onopen = () => {
    console.log('WebSocket connection established with FastAPI server');
};
ws.onerror = (error) => {
    console.error('WebSocket Error:', error);
};

async function startCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const message = "The mediaDevices API is not available in your browser. Please ensure you are running on a secure context (https or localhost).";
        console.error(message);
        alert(message);
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
            }
        });
        videoElement.srcObject = stream;
        await setupAudioProcessing(stream);
    } catch (error) {
        console.error('Error accessing media devices.', error);
    }
}

async function setupAudioProcessing(stream) {
    const audioContext = new AudioContext({ sampleRate: 16000 });
    
    try {
        await audioContext.audioWorklet.addModule('audio-processor.js');
    } catch (e) {
        console.error('Error loading audio worklet module', e);
        return;
    }
    
    const source = audioContext.createMediaStreamSource(stream);
    const audioProcessorNode = new AudioWorkletNode(audioContext, 'audio-processor');
    
    audioProcessorNode.port.onmessage = (event) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(event.data);
        }
    };
    
    source.connect(audioProcessorNode);
}

startCapture();
