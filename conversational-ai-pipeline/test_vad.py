#!/usr/bin/env python3
"""
Test script to demonstrate Voice Activity Detection (VAD)
Shows how to check if someone is speaking given audio data format
"""

import pyaudio
import numpy as np
import time
from models.VAD import WebRtC as VAD
from models.Whisper import transcribe_bytes, transcribe_buffer, create_audio_buffer, add_to_buffer
from models.Wav2Vec2EM import recognize_emotion_from_buffer, get_emotion_labels


def test_speech_detection():
    """Test speech detection with live microphone input"""
    
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
    
    print("Speech Detection Test")
    print("=====================")
    print("Audio Format:")
    print(f"  - Sample Rate: {RATE} Hz")
    print(f"  - Channels: {CHANNELS}")
    print(f"  - Format: 16-bit PCM")
    print(f"  - Chunk Size: {CHUNK} samples ({CHUNK/RATE*1000:.1f}ms)")
    print()
    print("Speak into your microphone to test speech detection")
    print("Press Ctrl+C to stop")
    print()
    
    try:
        while True:
            # Read audio data
            audio_data = stream.read(CHUNK, exception_on_overflow=False)
            
            # Convert to numpy array for analysis
            audio_array = np.frombuffer(audio_data, dtype=np.int16)
            
            # Calculate audio levels with error handling
            if len(audio_array) > 0:
                # Calculate RMS safely
                mean_squared = np.mean(audio_array**2)
                if mean_squared >= 0 and not np.isnan(mean_squared):
                    rms = np.sqrt(mean_squared)
                else:
                    rms = 0
                
                # Calculate peak safely
                peak = np.max(np.abs(audio_array))
                if np.isnan(peak):
                    peak = 0
            else:
                rms = 0
                peak = 0
            
            # Check for speech using VAD
            speech_detected = vad.is_speech(audio_data)
            
            # Display results
            speech_indicator = "🟢 SPEECH" if speech_detected else "🔴 SILENCE"
            level_bar = "█" * min(int(rms / 1000), 20)  # Simple level indicator
            
            print(f"\rAudio: {rms:6.0f} RMS | {peak:6.0f} Peak | {level_bar:20} | {speech_indicator}", 
                  end="", flush=True)
            
            time.sleep(0.1)  # Update every 100ms
            
    except KeyboardInterrupt:
        print("\n\nStopping speech detection test...")
    
    finally:
        stream.stop_stream()
        stream.close()
        p.terminate()
        print("Test completed.")

def explain_audio_format():
    """Explain the audio data format and how VAD works"""
    print("Audio Data Format Explanation")
    print("=============================")
    print()
    print("1. Audio Data Format:")
    print("   - Format: 16-bit PCM (paInt16)")
    print("   - Sample Rate: 16000 Hz (16kHz)")
    print("   - Channels: 1 (mono)")
    print("   - Chunk Size: 1024 samples")
    print("   - Duration per chunk: 64ms (1024/16000)")
    print()
    print("2. How to Check for Speech:")
    print("   - Audio data comes as bytes from PyAudio")
    print("   - Convert to numpy array: np.frombuffer(audio_data, dtype=np.int16)")
    print("   - Use WebRTC VAD to detect speech patterns")
    print("   - VAD processes audio in 10ms, 20ms, or 30ms chunks")
    print()
    print("3. VAD Aggressiveness Levels:")
    print("   - 0: Least aggressive (more sensitive to speech)")
    print("   - 1: Low aggressiveness")
    print("   - 2: Medium aggressiveness (recommended)")
    print("   - 3: Most aggressive (less sensitive to speech)")
    print()
    print("4. Usage Example:")
    print("   ```python")
    print("   from models.VAD import WebRtC as VAD")
    print("   ")
    print("   # Initialize VAD")
    print("   vad = VAD(aggressiveness=2)")
    print("   ")
    print("   # Check if audio contains speech")
    print("   speech_detected = vad.is_speech(audio_data)")
    print("   print('Speech detected:', speech_detected)")
    print("   ```")

def test_whisper():
    """Test Whisper with live microphone input"""
    print("Whisper Test")
    print("============")
    print()
    print("Speak into your microphone to test whisper")
    print("Press Ctrl+C to stop")
    print()
    
    # Audio configuration (matches the recording setup)
    FORMAT = pyaudio.paInt16
    CHANNELS = 1
    RATE = 16000
    CHUNK = 1024
    
    # Initialize variables
    p = None
    stream = None
    audio_buffer = None
    
    try:
        # Initialize PyAudio
        p = pyaudio.PyAudio()
        
        # Initialize audio buffer for accumulating audio
        audio_buffer = create_audio_buffer()
        
        stream = p.open(format=FORMAT,
                        channels=CHANNELS,
                        rate=RATE,
                        input=True,
                        frames_per_buffer=CHUNK)

        print("Recording audio... Speak clearly!")
        print("(Whisper needs several seconds of audio for best results)")
        print()

        while True:
            # Read audio data
            audio_data = stream.read(CHUNK, exception_on_overflow=False)
            
            # Add to buffer
            audio_buffer = add_to_buffer(audio_buffer, audio_data)
            
            # Transcribe every 5 seconds (approximately 78 chunks at 1024 samples)
            if len(audio_buffer) >= 78:  # ~5 seconds of audio
                text = transcribe_buffer(audio_buffer)
                if text.strip():
                    print(f"Transcribed: {text}")
                audio_buffer = []  # Clear buffer after transcription
            
            time.sleep(0.1)  # Small delay to prevent excessive processing
    
    except KeyboardInterrupt:
        print("\n\nStopping whisper test...")
        
        # Transcribe any remaining audio
        if audio_buffer:
            print("Transcribing remaining audio...")
            text = transcribe_buffer(audio_buffer)
            if text.strip():
                print(f"Final transcription: {text}")
    
    except Exception as e:
        print(f"Error during whisper test: {e}")
    
    finally:
        if stream:
            stream.stop_stream()
            stream.close()
        if p:
            p.terminate()
        print("Test completed.")

def test_emotion_recognition():
    """Test emotion recognition with live microphone input"""
    print("Emotion Recognition Test")
    print("========================")
    print()
    print("Speak into your microphone to test emotion recognition")
    print("Press Ctrl+C to stop")
    print()
    
    # Audio configuration (matches the recording setup)
    FORMAT = pyaudio.paInt16
    CHANNELS = 1
    RATE = 16000
    CHUNK = 1024
    
    # Initialize variables
    p = None
    stream = None
    audio_buffer = None
    
    try:
        # Initialize PyAudio
        p = pyaudio.PyAudio()
        
        # Initialize audio buffer for accumulating audio
        audio_buffer = create_audio_buffer()
        
        stream = p.open(format=FORMAT,
                        channels=CHANNELS,
                        rate=RATE,
                        input=True,
                        frames_per_buffer=CHUNK)

        print("Recording audio for emotion recognition...")
        print("(Model needs several seconds of audio for best results)")
        print("Available emotions:", ", ".join(get_emotion_labels()))
        print()

        while True:
            # Read audio data
            audio_data = stream.read(CHUNK, exception_on_overflow=False)
            
            # Add to buffer
            audio_buffer = add_to_buffer(audio_buffer, audio_data)
            
            # Recognize emotion every 3 seconds (approximately 47 chunks at 1024 samples)
            if len(audio_buffer) >= 47:  # ~3 seconds of audio
                result = recognize_emotion_from_buffer(audio_buffer)
                if result["emotion"] not in ["insufficient_audio", "no_audio", "error"]:
                    confidence = result["confidence"] * 100
                    print(f"Emotion: {result['emotion']} (Confidence: {confidence:.1f}%)")
                audio_buffer = []  # Clear buffer after recognition
            
            time.sleep(0.1)  # Small delay to prevent excessive processing
    
    except KeyboardInterrupt:
        print("\n\nStopping emotion recognition test...")
        
        # Recognize emotion in any remaining audio
        if audio_buffer:
            print("Analyzing remaining audio...")
            result = recognize_emotion_from_buffer(audio_buffer)
            if result["emotion"] not in ["insufficient_audio", "no_audio", "error"]:
                confidence = result["confidence"] * 100
                print(f"Final emotion: {result['emotion']} (Confidence: {confidence:.1f}%)")
    
    except Exception as e:
        print(f"Error during emotion recognition test: {e}")
    
    finally:
        if stream:
            stream.stop_stream()
            stream.close()
        if p:
            p.terminate()
        print("Test completed.")

if __name__ == "__main__":
    print("Audio Processing Test Suite")
    print("===========================")
    print()
    
    # Show explanation first
    explain_audio_format()
    print()
    
    # Ask user which test to run
    print("Available tests:")
    print("1. Speech Detection (VAD)")
    print("2. Whisper Transcription")
    print("3. Emotion Recognition")
    print("4. All Tests")
    print()
    
    response = input("Choose test (1/2/3/4): ").strip()
    
    if response == "1":
        print("\nRunning VAD test...")
        test_speech_detection()
    elif response == "2":
        print("\nRunning Whisper test...")
        test_whisper()
    elif response == "3":
        print("\nRunning Emotion Recognition test...")
        test_emotion_recognition()
    elif response == "4":
        print("\nRunning all tests...")
        print("First: VAD test")
        test_speech_detection()
        print("\nSecond: Whisper test")
        test_whisper()
        print("\nThird: Emotion Recognition test")
        test_emotion_recognition()
    else:
        print("Invalid choice. Tests skipped.")
