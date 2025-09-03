import pyaudio
import queue
import threading
import wave
import cv2
import numpy as np
import mss
import time
import os

class AudioRecorder:
    """Handles audio recording functionality"""
    
    def __init__(self, rate=16000, channels=1, chunk=1024, format=pyaudio.paInt16):
        self.rate = rate
        self.channels = channels
        self.chunk = chunk
        self.format = format
        self.frames = []
        self.recording = False
        self.audio_queue = queue.Queue()
        
        self.p = pyaudio.PyAudio()
        self.stream = self.p.open(
            format=self.format,
            channels=self.channels,
            rate=self.rate,
            input=True,
            frames_per_buffer=self.chunk
        )
        
    def start_recording(self):
        """Start audio recording in a separate thread"""
        self.recording = True
        self.thread = threading.Thread(target=self._record_audio)
        self.thread.start()
        print("Audio recording started...")
        
    def _record_audio(self):
        """Internal method for recording audio"""
        while self.recording:
            try:
                data = self.stream.read(self.chunk, exception_on_overflow=False)
                self.frames.append(data)
                self.audio_queue.put(data)
            except Exception as e:
                print(f"Audio recording error: {e}")
                break
                
    def stop_recording(self):
        """Stop audio recording"""
        self.recording = False
        if hasattr(self, 'thread'):
            self.thread.join()
            
    def save_audio(self, output_path):
        """Save recorded audio to WAV file"""
        if not self.frames:
            print("No audio frames to save")
            return
            
        with wave.open(output_path, 'wb') as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(self.p.get_sample_size(self.format))
            wf.setframerate(self.rate)
            wf.writeframes(b''.join(self.frames))
        print(f"Audio saved to: {output_path}")
        
    def cleanup(self):
        """Clean up audio resources"""
        self.stop_recording()
        self.stream.stop_stream()
        self.stream.close()
        self.p.terminate()

class CameraRecorder:
    """Handles camera recording functionality"""
    
    def __init__(self, camera_index=0, width=640, height=480, fps=30):
        self.camera_index = camera_index
        self.width = width
        self.height = height
        self.fps = fps
        self.frames = []
        self.recording = False
        self.camera_queue = queue.Queue()
        
        self.camera = cv2.VideoCapture(camera_index)
        self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.camera.set(cv2.CAP_PROP_FPS, fps)
        
        self.camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimize buffer size
        self.camera.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))  # Use MJPG for better performance
        
        self.writer = None
        
    def set_output_file(self, output_path):
        """Set the output file for video recording"""
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self.writer = cv2.VideoWriter(output_path, fourcc, self.fps, (self.width, self.height))
        
    def start_recording(self):
        """Start camera recording in a separate thread"""
        if not self.writer:
            raise ValueError("Output file not set. Call set_output_file() first.")
            
        self.recording = True
        self.thread = threading.Thread(target=self._record_camera)
        self.thread.start()
        print("Camera recording started...")
        
    def _record_camera(self):
        """Internal method for recording camera"""
        import time
        
        frame_interval = 1.0 / self.fps
        last_frame_time = time.time()
        
        while self.recording:
            try:
                current_time = time.time()
                
                if current_time - last_frame_time >= frame_interval:
                    ret, frame = self.camera.read()
                    if ret:
                        frame = cv2.flip(frame, 1)
                        
                        self.frames.append(frame)
                        self.writer.write(frame)
                        
                        while not self.camera_queue.empty():
                            try:
                                self.camera_queue.get_nowait()
                            except queue.Empty:
                                break
                        
                        self.camera_queue.put(frame)
                        last_frame_time = current_time
                    else:
                        print("Failed to read camera frame")
                        break
                else:
                    time.sleep(0.001)
                    
            except Exception as e:
                print(f"Camera recording error: {e}")
                break
                
    def stop_recording(self):
        """Stop camera recording"""
        self.recording = False
        if hasattr(self, 'thread'):
            self.thread.join()
            
    def cleanup(self):
        """Clean up camera resources"""
        self.stop_recording()
        if self.writer:
            self.writer.release()
        self.camera.release()

class ScreenRecorder:
    """Handles screen recording functionality"""
    
    def __init__(self, width=1920, height=1080, fps=30):
        self.width = width
        self.height = height
        self.fps = fps
        self.frames = []
        self.recording = False
        self.screen_queue = queue.Queue()
        
        self.sct = mss.mss()
        self.monitor = self.sct.monitors[1]  # Primary monitor
        
        self.writer = None
        
    def set_output_file(self, output_path):
        """Set the output file for screen recording"""
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self.writer = cv2.VideoWriter(output_path, fourcc, self.fps, (self.width, self.height))
        
    def start_recording(self):
        """Start screen recording in a separate thread"""
        if not self.writer:
            raise ValueError("Output file not set. Call set_output_file() first.")
            
        self.recording = True
        self.thread = threading.Thread(target=self._record_screen)
        self.thread.start()
        print("Screen recording started...")
        
    def _record_screen(self):
        """Internal method for recording screen"""
        while self.recording:
            try:
                screenshot = self.sct.grab(self.monitor)
                frame = np.array(screenshot)
                
                frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
                
                if frame.shape[1] != self.width or frame.shape[0] != self.height:
                    frame = cv2.resize(frame, (self.width, self.height))
                
                self.frames.append(frame)
                self.writer.write(frame)
                self.screen_queue.put(frame)
                
                time.sleep(1/self.fps)
            except Exception as e:
                print(f"Screen recording error: {e}")
                break
                
    def stop_recording(self):
        """Stop screen recording"""
        self.recording = False
        if hasattr(self, 'thread'):
            self.thread.join()
            
    def cleanup(self):
        """Clean up screen recording resources"""
        self.stop_recording()
        if self.writer:
            self.writer.release()
        self.sct.close()

class RecordingManager:
    """Manages all recording components"""
    
    def __init__(self, output_dir):
        self.output_dir = output_dir
        self.recording = False
        
        os.makedirs(output_dir, exist_ok=True)
        
        self.audio_recorder = AudioRecorder()
        self.camera_recorder = CameraRecorder(fps=60)  # Higher FPS for lower latency
        self.screen_recorder = ScreenRecorder(fps=60)  # Higher FPS for smoother screen recording
        
        self.camera_recorder.set_output_file(f"{output_dir}/camera.mp4")
        self.screen_recorder.set_output_file(f"{output_dir}/screen.mp4")
        
    def start_recording(self):
        """Start all recording components"""
        self.recording = True
        self.audio_recorder.start_recording()
        self.camera_recorder.start_recording()
        self.screen_recorder.start_recording()
        
    def stop_recording(self):
        """Stop all recording components"""
        self.recording = False
        self.audio_recorder.stop_recording()
        self.camera_recorder.stop_recording()
        self.screen_recorder.stop_recording()
        
    def save_recordings(self):
        """Save all recordings"""
        self.audio_recorder.save_audio(f"{self.output_dir}/audio.wav")
        print(f"All recordings saved to: {self.output_dir}")
        
    def cleanup(self):
        """Clean up all recording resources"""
        self.audio_recorder.cleanup()
        self.camera_recorder.cleanup()
        self.screen_recorder.cleanup()
        
    def get_audio_queue(self):
        """Get audio queue for visualization"""
        return self.audio_recorder.audio_queue
        
    def get_camera_queue(self):
        """Get camera queue for preview"""
        return self.camera_recorder.camera_queue
        
    def get_screen_queue(self):
        """Get screen queue for preview"""
        return self.screen_recorder.screen_queue
