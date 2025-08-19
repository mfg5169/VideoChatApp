# Speech Detection Guide

This guide explains how to check if someone is speaking given the audio data format used in this project.

## Audio Data Format

The audio data in this project has the following characteristics:

- **Format**: 16-bit PCM (`pyaudio.paInt16`)
- **Sample Rate**: 16000 Hz (16kHz)
- **Channels**: 1 (mono)
- **Chunk Size**: 1024 samples
- **Duration per chunk**: 64ms (1024/16000)

## How to Check for Speech

### Method 1: Using WebRTC Voice Activity Detection (VAD) - Recommended

The project includes a VAD implementation that uses Google's WebRTC VAD algorithm:

```python
from models.VAD import WebRtC as VAD

# Initialize VAD with desired aggressiveness
vad = VAD(aggressiveness=2)  # 0=least aggressive, 3=most aggressive

# Check if audio contains speech
speech_detected = vad.is_speech(audio_data)
print("Speech detected:", speech_detected)
```

#### VAD Aggressiveness Levels

- **0**: Least aggressive - More sensitive to speech, may detect background noise as speech
- **1**: Low aggressiveness - Good balance for most environments
- **2**: Medium aggressiveness - Recommended for general use
- **3**: Most aggressive - Less sensitive, may miss quiet speech

### Method 2: Simple Audio Level Detection

For basic speech detection, you can use audio level thresholds:

```python
import numpy as np

def check_speech_by_level(audio_data, threshold=1000):
    """
    Simple speech detection based on audio level
    
    Args:
        audio_data: Audio data as bytes
        threshold: RMS threshold for speech detection
        
    Returns:
        bool: True if audio level exceeds threshold
    """
    # Convert bytes to numpy array
    audio_array = np.frombuffer(audio_data, dtype=np.int16)
    
    # Calculate RMS (Root Mean Square) level
    rms = np.sqrt(np.mean(audio_array**2))
    
    # Check if level exceeds threshold
    return rms > threshold
```

### Method 3: Advanced Audio Analysis

For more sophisticated speech detection, you can combine multiple metrics:

```python
import numpy as np

def advanced_speech_detection(audio_data, rms_threshold=1000, peak_threshold=3000):
    """
    Advanced speech detection using multiple audio metrics
    
    Args:
        audio_data: Audio data as bytes
        rms_threshold: RMS level threshold
        peak_threshold: Peak level threshold
        
    Returns:
        dict: Dictionary with detection results and metrics
    """
    # Convert bytes to numpy array
    audio_array = np.frombuffer(audio_data, dtype=np.int16)
    
    # Calculate various audio metrics
    rms = np.sqrt(np.mean(audio_array**2))
    peak = np.max(np.abs(audio_array))
    mean = np.mean(audio_array)
    std = np.std(audio_array)
    
    # Speech detection logic
    speech_detected = (rms > rms_threshold and peak > peak_threshold)
    
    return {
        'speech_detected': speech_detected,
        'rms': rms,
        'peak': peak,
        'mean': mean,
        'std': std,
        'metrics': {
            'rms_above_threshold': rms > rms_threshold,
            'peak_above_threshold': peak > peak_threshold
        }
    }
```

## Integration with the Main Application

The main application (`main.py`) already includes speech detection. Here's how it works:

```python
def update_audio_visualization(self, audio_data):
    """Update audio visualization with speech detection"""
    try:
        # Convert bytes to numpy array
        audio_array = np.frombuffer(audio_data, dtype=np.int16)

        # Initialize VAD once (reuse instance for better performance)
        if not hasattr(self, 'vad'):
            self.vad = VAD(aggressiveness=2)
        
        # Check for speech
        speech_detected = self.vad.is_speech(audio_data)
        
        # Update speech status
        speech_status = "🟢 SPEECH DETECTED" if speech_detected else "🔴 No Speech"
        print(f"Speech Detection: {speech_status}")
        
        # Update interface
        self.speech_label.config(text=f"Speech: {speech_status}")
        
        # ... rest of visualization code ...
        
    except Exception as e:
        print(f"Audio visualization error: {e}")
```

## Testing Speech Detection

Run the test script to see speech detection in action:

```bash
cd conversational-ai-pipeline
python test_vad.py
```

This will:
1. Show the audio format explanation
2. Run a live speech detection test using your microphone
3. Display real-time results with audio levels and speech detection

## Troubleshooting

### Common Issues

1. **No speech detected**: 
   - Check microphone permissions
   - Try lowering the VAD aggressiveness (use 0 or 1)
   - Verify audio levels are above threshold

2. **False positives (noise detected as speech)**:
   - Increase VAD aggressiveness (use 2 or 3)
   - Adjust audio level thresholds
   - Improve microphone positioning

3. **Performance issues**:
   - VAD instance is reused to avoid reinitialization
   - Processing is done in chunks for efficiency

### Debugging

Add debug output to see what's happening:

```python
def debug_speech_detection(audio_data):
    """Debug speech detection with detailed output"""
    audio_array = np.frombuffer(audio_data, dtype=np.int16)
    rms = np.sqrt(np.mean(audio_array**2))
    peak = np.max(np.abs(audio_array))
    
    vad = VAD(aggressiveness=2)
    speech_detected = vad.is_speech(audio_data)
    
    print(f"Audio: RMS={rms:.0f}, Peak={peak:.0f}, Speech={speech_detected}")
    return speech_detected
```

## Best Practices

1. **Choose appropriate aggressiveness**: Start with level 2 and adjust based on your environment
2. **Handle edge cases**: Always check for empty or invalid audio data
3. **Reuse VAD instances**: Don't create new VAD instances for each audio chunk
4. **Combine methods**: Use VAD for primary detection and audio levels for validation
5. **Test thoroughly**: Use the test script to verify detection works in your environment

## Example Usage in Your Code

```python
# Simple usage
from models.VAD import WebRtC as VAD

vad = VAD(aggressiveness=2)

def process_audio(audio_data):
    if vad.is_speech(audio_data):
        print("Someone is speaking!")
        # Handle speech detection
    else:
        print("Silence detected")
        # Handle silence
```

This approach provides reliable speech detection for your audio processing pipeline.
