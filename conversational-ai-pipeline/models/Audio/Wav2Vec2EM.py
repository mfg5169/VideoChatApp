import torch
import librosa
import numpy as np
from datasets import load_dataset
from transformers import Wav2Vec2ForSequenceClassification, Wav2Vec2FeatureExtractor

model = None
feature_extractor = None

## Emotion Recognition based on Audio

def load_emotion_model():
    global model, feature_extractor
    if model is None:
        print("Loading emotion recognition model...")
        model = Wav2Vec2ForSequenceClassification.from_pretrained("superb/wav2vec2-base-superb-er")
        feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained("superb/wav2vec2-base-superb-er")
        print("Emotion recognition model loaded!")
    return model, feature_extractor

def map_to_array(example):
    speech, _ = librosa.load(example["file"], sr=16000, mono=True)
    example["speech"] = speech
    return example

def recognize_emotion_from_bytes(audio_bytes, sample_rate=16000):
    """
    Recognize emotion from audio bytes
    
    Args:
        audio_bytes: Audio data as bytes (16-bit PCM, 16kHz, mono)
        sample_rate: Sample rate of the audio (default: 16000)
        
    Returns:
        dict: Dictionary with emotion prediction and confidence
    """
    try:
        model, feature_extractor = load_emotion_model()
        
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        
        if len(audio_np) < sample_rate * 0.5:  # Need at least 0.5 seconds
            return {"emotion": "insufficient_audio", "confidence": 0.0}
        
        inputs = feature_extractor(audio_np, sampling_rate=sample_rate, padding=True, return_tensors="pt")
        
        with torch.no_grad():
            logits = model(**inputs).logits
            probabilities = torch.softmax(logits, dim=-1)
            predicted_id = torch.argmax(logits, dim=-1).item()
            confidence = probabilities[0][predicted_id].item()
        
        emotion = model.config.id2label[predicted_id]
        
        return {
            "emotion": emotion,
            "confidence": confidence,
            "probabilities": probabilities[0].tolist()
        }
        
    except Exception as e:
        print(f"Emotion recognition error: {e}")
        return {"emotion": "error", "confidence": 0.0}

def recognize_emotion_from_buffer(audio_buffer, sample_rate=16000):
    """
    Recognize emotion from accumulated audio buffer
    
    Args:
        audio_buffer: List of audio arrays
        sample_rate: Sample rate of the audio
        
    Returns:
        dict: Dictionary with emotion prediction and confidence
    """
    try:
        if not audio_buffer:
            return {"emotion": "no_audio", "confidence": 0.0}
        
        audio_np = np.concatenate(audio_buffer)
        
        audio_bytes = (audio_np * 32768.0).astype(np.int16).tobytes()
        
        return recognize_emotion_from_bytes(audio_bytes, sample_rate)
        
    except Exception as e:
        print(f"Emotion recognition from buffer error: {e}")
        return {"emotion": "error", "confidence": 0.0}

def get_emotion_labels():
    """Get list of available emotion labels"""
    model, _ = load_emotion_model()
    return list(model.config.id2label.values())

def demo_with_dataset():
    """Demo function using the original dataset approach"""
    dataset = load_dataset("anton-l/superb_demo", "er", split="session1")
    dataset = dataset.map(map_to_array)

    model, feature_extractor = load_emotion_model()

    inputs = feature_extractor(dataset[:4]["speech"], sampling_rate=16000, padding=True, return_tensors="pt")

    logits = model(**inputs).logits
    predicted_ids = torch.argmax(logits, dim=-1)
    labels = [model.config.id2label[_id] for _id in predicted_ids.tolist()]
    
    return labels
