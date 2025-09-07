
import webrtcvad

class WebRtC:
    def __init__(self, aggressiveness=3, sample_rate=16000):
        self.vad = webrtcvad.Vad()
        self.vad.set_mode(aggressiveness)
        self.sample_rate = sample_rate

    def is_speech(self, frame):
        """
        Check if the audio frame contains speech
        
        Args:
            frame: Audio data as bytes (16-bit PCM, 16kHz, mono)
            
        Returns:
            bool: True if speech is detected, False otherwise
        """
        try:
            # WebRTC VAD expects specific frame durations:
            # - 10ms: 160 samples at 16kHz
            # - 20ms: 320 samples at 16kHz  
            # - 30ms: 480 samples at 16kHz
            
            # Our audio chunks are 1024 samples, which is 64ms at 16kHz
            # We'll process this in 30ms chunks (480 samples) for better accuracy
            
            frame_length = len(frame)
            samples_per_30ms = int(self.sample_rate * 0.03) 
            
            if frame_length < samples_per_30ms * 2:  
                return False
                
            speech_detected = False
            num_chunks = 0
            
            for i in range(0, frame_length - samples_per_30ms * 2, samples_per_30ms * 2):
                chunk = frame[i:i + samples_per_30ms * 2]
                if len(chunk) == samples_per_30ms * 2:  
                    try:
                        if self.vad.is_speech(chunk, self.sample_rate):
                            speech_detected = True
                        num_chunks += 1
                    except Exception as e:
                        print(f"VAD processing error: {e}")
                        continue
            
            return speech_detected
            
        except Exception as e:
            print(f"VAD error: {e}")
            return False


if __name__ == "__main__":
    # Test with silence
    vad = WebRtC(aggressiveness=3, sample_rate=16000)
    silence_frame = b'\x00\x00' * 480 
    result = vad.is_speech(silence_frame)
    print(f"Silence test - Contains speech: {result}")
    
    # Test with some audio data (you would need real audio data for this)
    # audio_frame = b'\x00\x00' * 480  # Replace with actual audio data
    # result = vad.is_speech(audio_frame)
    # print(f"Audio test - Contains speech: {result}")