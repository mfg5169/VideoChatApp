
import pyaudio
import numpy as np
import time
from models.Audio.VAD import WebRtC as VAD
    # Audio configuration (matches the recording setup)
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1024
    
    # Initialize PyAudio
p = pyaudio.PyAudio()
    
    # Initialize VAD with medium aggressiveness
vad = VAD(aggressiveness=2)  # 0=least aggressive, 3=most aggressive
    
stream = p.open(format=FORMAT,
                    channels=CHANNELS,
                    rate=RATE,
                    input=True,
                    frames_per_buffer=CHUNK)

audio_data = stream.read(CHUNK, exception_on_overflow=False)
speech_detected = vad.is_speech(audio_data)


if speech_detected