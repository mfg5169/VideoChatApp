from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import numpy as np
from models.Audio.VAD import WebRtC as VAD

print("Starting VAD WebSocket server...")
app = FastAPI()
VoiceDetector = VAD(aggressiveness=2)
print("VAD initialized")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connection established")
    while True:
        print("Waiting for data....")
        data = await websocket.receive_bytes()

        audio_chunks_f32 = np.frombuffer(data, dtype=np.float32)
        print("Audio chunks received: ", len(audio_chunks_f32))
        int16_audio = (audio_chunks_f32 * 32767).astype(np.int16)
        print(int16_audio)

        speech_detected = VoiceDetector.is_speech(int16_audio)
        print(f"Speech detected: {speech_detected}")
    await websocket.close()

print("VAD WebSocket server is running")
@app.get("/")
def read_root():

    return {"status": "VAD WebSocket server is running"}

print("Done VAD WebSocket server is running")