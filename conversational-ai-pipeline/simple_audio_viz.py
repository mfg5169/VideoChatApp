#!/usr/bin/env python3
"""
Simple audio visualization test to verify audio recording is working
"""

import pyaudio
import numpy as np
import time
import threading
import queue

# Audio configuration
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1024

def test_audio_recording():
    """Test audio recording and print levels"""
    p = pyaudio.PyAudio()
    
    stream = p.open(format=FORMAT,
                    channels=CHANNELS,
                    rate=RATE,
                    input=True,
                    frames_per_buffer=CHUNK)
    
    print("Audio recording test started...")
    print("Speak into your microphone to see audio levels")
    print("Press Ctrl+C to stop")
    
    try:
        while True:
            data = stream.read(CHUNK, exception_on_overflow=False)
            audio_array = np.frombuffer(data, dtype=np.int16)
            
            # Calculate audio level with error handling
            try:
                rms = np.sqrt(np.mean(audio_array**2))
                if np.isnan(rms):
                    rms = 0
                peak = np.max(np.abs(audio_array))
                if np.isnan(peak):
                    peak = 0
                
                # Create a simple text-based visualization
                level = int(rms / 1000) if rms > 0 else 0  # Scale down for display
                bar = "█" * min(level, 50)  # Max 50 characters
                
                print(f"\rAudio Level: {rms:6.0f} RMS | {peak:6.0f} Peak | {bar}", end="", flush=True)
            except Exception as e:
                print(f"\rAudio Error: {e}", end="", flush=True)
            
            time.sleep(0.1)
            
    except KeyboardInterrupt:
        print("\nStopping audio test...")
    
    finally:
        stream.stop_stream()
        stream.close()
        p.terminate()
        print("Audio test stopped")

if __name__ == "__main__":
    test_audio_recording()
