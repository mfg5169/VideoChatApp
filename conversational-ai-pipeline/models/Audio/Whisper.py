import whisper
import numpy as np
import io
import wave

# Load the model once (reuse for better performance)
model = whisper.load_model("base")

def transcribe_bytes(audio_bytes):
    """
    Transcribe audio bytes directly using Whisper without saving files
    
    Args:
        audio_bytes: Audio data as bytes (16-bit PCM, 16kHz, mono)
        
    Returns:
        str: Transcribed text
    """
    try:
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        
        audio_np = whisper.pad_or_trim(audio_np)
        
        mel = whisper.log_mel_spectrogram(audio_np, n_mels=model.dims.n_mels).to(model.device)
        
        _, probs = model.detect_language(mel)
        detected_language = max(probs, key=probs.get)
        
        options = whisper.DecodingOptions()
        result = whisper.decode(model, mel, options)
        
        return result.text.strip()
        
    except Exception as e:
        print(f"Whisper transcription error: {e}")
        return ""

def transcribe_audio_chunk(audio_bytes, sample_rate=16000):
    """
    Transcribe a single audio chunk (for real-time processing)
    
    Args:
        audio_bytes: Audio data as bytes (16-bit PCM, 16kHz, mono)
        sample_rate: Sample rate of the audio (default: 16000)
        
    Returns:
        str: Transcribed text
    """
    try:
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        

        if len(audio_np) > 0:
            audio_np = whisper.pad_or_trim(audio_np)
            
            mel = whisper.log_mel_spectrogram(audio_np, n_mels=model.dims.n_mels).to(model.device)
            
            options = whisper.DecodingOptions()
            result = whisper.decode(model, mel, options)
            
            return result.text.strip()
        else:
            return ""
            
    except Exception as e:
        print(f"Whisper chunk transcription error: {e}")
        return ""

def create_audio_buffer():
    """
    Create an audio buffer for accumulating audio chunks
    Useful for real-time transcription
    """
    return []

def add_to_buffer(buffer, audio_bytes):
    """
    Add audio bytes to the buffer
    
    Args:
        buffer: Audio buffer (list of audio arrays)
        audio_bytes: Audio data as bytes
        
    Returns:
        list: Updated buffer
    """
    audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    buffer.append(audio_np)
    return buffer

def transcribe_buffer(buffer, sample_rate=16000):
    """
    Transcribe accumulated audio from buffer
    
    Args:
        buffer: Audio buffer (list of audio arrays)
        sample_rate: Sample rate of the audio
        
    Returns:
        str: Transcribed text
    """
    try:
        if not buffer:
            return ""
            
        audio_np = np.concatenate(buffer)
        
        audio_np = whisper.pad_or_trim(audio_np)
        
        mel = whisper.log_mel_spectrogram(audio_np, n_mels=model.dims.n_mels).to(model.device)
        
        options = whisper.DecodingOptions()
        result = whisper.decode(model, mel, options)
        
        return result.text.strip()
        
    except Exception as e:
        print(f"Whisper buffer transcription error: {e}")
        return ""

