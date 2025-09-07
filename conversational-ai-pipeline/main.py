import cv2
import numpy as np
import queue
import os

from datetime import datetime
import tkinter as tk
from tkinter import ttk

from PIL import Image, ImageTk
from mediasources import RecordingManager
from models.Audio.VAD import WebRtC as VAD

class VisualInterface:
    """Handles the visual interface for the recording dashboard"""
    
    def __init__(self, recording_manager):
        self.recording_manager = recording_manager
        self.recording = True
        
        self.preview_width = 320
        self.preview_height = 240
        self.screen_preview_width = 480
        self.screen_preview_height = 270
        
        self.setup_interface()
        
    def setup_interface(self):
        """Setup the main interface"""
        self.root = tk.Tk()
        self.root.title("Multi-Media Recording Dashboard")
        self.root.geometry("1200x800")
        self.root.configure(bg='#2b2b2b')
        
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        self.create_title_section(main_frame)
        self.create_video_section(main_frame)
        self.create_audio_section(main_frame)
        self.create_controls_section(main_frame)
        self.create_status_section(main_frame)
        
        self.setup_audio_visualization()
        
        self.update_displays()
        
    def create_title_section(self, parent):
        """Create the title section"""
        title_label = ttk.Label(parent, text="Recording Dashboard", 
                               font=('Arial', 16, 'bold'))
        title_label.pack(pady=(0, 20))
        
    def create_video_section(self, parent):
        """Create the video preview section"""
        video_frame = ttk.LabelFrame(parent, text="Video Streams", padding=10)
        video_frame.pack(fill=tk.X, pady=(0, 10))
        
        camera_frame = ttk.Frame(video_frame)
        camera_frame.pack(side=tk.LEFT, padx=(0, 10))
        
        ttk.Label(camera_frame, text="Camera Feed").pack()
        self.camera_label = ttk.Label(camera_frame, text="Initializing...")
        self.camera_label.pack()
        
        screen_frame = ttk.Frame(video_frame)
        screen_frame.pack(side=tk.LEFT)
        
        ttk.Label(screen_frame, text="Screen Recording").pack()
        self.screen_label = ttk.Label(screen_frame, text="Initializing...")
        self.screen_label.pack()
        
    def create_audio_section(self, parent):
        """Create the audio visualization section"""
        audio_frame = ttk.LabelFrame(parent, text="Audio Visualization", padding=10)
        audio_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 10))
        
        self.audio_text = tk.Text(audio_frame, height=5, width=60, bg='black', fg='green', font=('Courier', 10))
        self.audio_text.pack(fill=tk.BOTH, expand=True)
        
        self.audio_level_label = ttk.Label(audio_frame, text="Audio Level: 0", font=('Arial', 12))
        self.audio_level_label.pack(pady=(5, 0))
        
        self.speech_label = ttk.Label(audio_frame, text="Speech: 🔴 No Speech", font=('Arial', 12, 'bold'))
        self.speech_label.pack(pady=(5, 0))
        
    def create_controls_section(self, parent):
        """Create the controls section"""
        controls_frame = ttk.Frame(parent)
        controls_frame.pack(fill=tk.X, pady=(0, 10))
        
        self.record_button = ttk.Button(controls_frame, text="Stop Recording", 
                                       command=self.stop_recording)
        self.record_button.pack(side=tk.LEFT, padx=(0, 10))
        
        self.status_text = tk.Text(controls_frame, height=3, width=60)
        self.status_text.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.status_text.insert(tk.END, "Recording started...\n")
        
    def create_status_section(self, parent):
        """Create the status indicators section"""
        status_frame = ttk.LabelFrame(parent, text="Status", padding=10)
        status_frame.pack(fill=tk.X)
        
        indicators_frame = ttk.Frame(status_frame)
        indicators_frame.pack()
        
        self.audio_status = ttk.Label(indicators_frame, text="🔴 Audio: Stopped")
        self.audio_status.pack(side=tk.LEFT, padx=(0, 20))
        
        self.camera_status = ttk.Label(indicators_frame, text="🔴 Camera: Stopped")
        self.camera_status.pack(side=tk.LEFT, padx=(0, 20))
        
        self.screen_status = ttk.Label(indicators_frame, text="🔴 Screen: Stopped")
        self.screen_status.pack(side=tk.LEFT)
        
    def setup_audio_visualization(self):
        """Setup audio visualization"""
        self.audio_history = []
        
    def update_audio_visualization(self, audio_data):
        """Update audio visualization"""
        try:
            audio_array = np.frombuffer(audio_data, dtype=np.int16)

            if not hasattr(self, 'vad'):
                self.vad = VAD(aggressiveness=2)  # Medium aggressiveness
            
            speech_detected = self.vad.is_speech(audio_data)
            
            speech_status = "🟢 SPEECH DETECTED" if speech_detected else "🔴 No Speech"
            print(f"Speech Detection: {speech_status}")
            
            self.speech_label.config(text=f"Speech: {speech_status}")
            
            if len(audio_array) > 0:
                rms = np.sqrt(np.mean(audio_array**2))
                if np.isnan(rms):
                    rms = 0
                peak = np.max(np.abs(audio_array))
                if np.isnan(peak):
                    peak = 0
                
                self.audio_level_label.config(text=f"Audio Level: {rms:.0f} RMS | {peak:.0f} Peak")
                
                level = int(rms / 100) if rms > 0 else 0
                bar = "█" * min(level, 50)  # Max 50 characters
                
                self.audio_history.append(bar)
                if len(self.audio_history) > 10:
                    self.audio_history.pop(0)
                
                self.audio_text.delete(1.0, tk.END)
                for i, hist_bar in enumerate(reversed(self.audio_history)):
                    self.audio_text.insert(tk.END, f"Frame {len(self.audio_history)-i:2d}: {hist_bar}\n")
                
        except Exception as e:
            print(f"Audio visualization error: {e}")
            
    def update_displays(self):
        """Update all displays"""
        if not self.recording:
            return
            
        try:
            camera_queue = self.recording_manager.get_camera_queue()
            if not camera_queue.empty():
                frame = None
                while not camera_queue.empty():
                    try:
                        frame = camera_queue.get_nowait()
                    except queue.Empty:
                        break
                
                if frame is not None:
                    preview_frame = cv2.resize(frame, (self.preview_width, self.preview_height))
                    
                    preview_frame_rgb = cv2.cvtColor(preview_frame, cv2.COLOR_BGR2RGB)
                    
                    pil_image = Image.fromarray(preview_frame_rgb)
                    img = ImageTk.PhotoImage(pil_image)
                    self.camera_label.configure(image=img, text="")
                    self.camera_label.image = img  # Keep a reference
                    self.camera_status.configure(text="🟢 Camera: Recording")
        except Exception as e:
            self.camera_status.configure(text="🔴 Camera: Error")
            
        try:
            screen_queue = self.recording_manager.get_screen_queue()
            if not screen_queue.empty():
                frame = screen_queue.get_nowait()
                if frame is not None:
                    preview_frame = cv2.resize(frame, (self.screen_preview_width, self.screen_preview_height))
                    preview_frame = cv2.cvtColor(preview_frame, cv2.COLOR_BGR2RGB)
                    
                    pil_image = Image.fromarray(preview_frame)
                    img = ImageTk.PhotoImage(pil_image)
                    self.screen_label.configure(image=img, text="")
                    self.screen_label.image = img  # Keep a reference
                    self.screen_status.configure(text="🟢 Screen: Recording")
        except Exception as e:
            self.screen_status.configure(text="🔴 Screen: Error")
            
        try:
            audio_queue = self.recording_manager.get_audio_queue()
            if not audio_queue.empty():
                audio_data = audio_queue.get_nowait()
                if audio_data is not None:
                    self.update_audio_visualization(audio_data)
                    self.audio_status.configure(text="🟢 Audio: Recording")
        except Exception as e:
            print(f"Audio update error: {e}")
            self.audio_status.configure(text="🔴 Audio: Error")
            
        self.root.after(16, self.update_displays)  # Update every ~16ms (60 FPS)
        
    def stop_recording(self):
        """Stop recording"""
        self.recording = False
        self.record_button.configure(state='disabled')
        self.status_text.insert(tk.END, "Stopping recording...\n")
        self.root.after(1000, self.root.quit)
        
    def run(self):
        """Run the interface"""
        self.root.mainloop()

def main():
    """Main function"""
    output_dir = f"recordings/{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    recording_manager = RecordingManager(output_dir)
    
    interface = VisualInterface(recording_manager)
    
    recording_manager.start_recording()
    
    interface.run()
    
    recording_manager.stop_recording()
    recording_manager.save_recordings()
    recording_manager.cleanup()
    
    print(f"All recordings saved to: {output_dir}")

if __name__ == "__main__":
    main()