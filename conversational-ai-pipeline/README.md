# Multi-Media Recording Pipeline

This script captures audio, video camera, and screen content simultaneously with a live visual interface.

## Features

- **Audio Recording**: Captures microphone input at 16kHz with real-time waveform visualization
- **Camera Recording**: Records from the default camera at 640x480 resolution with live preview
- **Screen Recording**: Captures the primary monitor at 1920x1080 resolution with live preview
- **Visual Dashboard**: Real-time interface showing all recording streams
- **Synchronized Recording**: All streams start and stop together
- **Organized Output**: Files are saved in timestamped directories

## Virtual Environment Setup

This project uses a virtual environment to manage dependencies.

### Option 1: Use the provided activation script
```bash
# Navigate to the project directory
cd conversational-ai-pipeline

# Activate the environment
./activate_env.sh
```

### Option 2: Manual activation
```bash
# Navigate to the project directory
cd conversational-ai-pipeline

# Activate the virtual environment
source venv/bin/activate

# Verify activation (you should see (venv) in your prompt)
```

### Deactivating the environment
```bash
deactivate
```

## Installation

The virtual environment is already set up with all required dependencies. If you need to recreate it:

1. Create a new virtual environment:
```bash
python3 -m venv venv
```

2. Activate the environment:
```bash
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. For macOS users, you may need to install portaudio:
```bash
brew install portaudio
```

## Usage

1. Activate the virtual environment:
```bash
./activate_env.sh
```

2. Run the script:
```bash
python main.py
```

3. A visual dashboard will open showing:
   - Live camera preview
   - Live screen recording preview
   - Real-time audio waveform
   - Status indicators for each stream
   - Stop recording button

4. Click "Stop Recording" to end the session
5. All files will be saved in a `recordings/YYYYMMDD_HHMMSS/` directory

## Visual Interface

The dashboard provides:

- **Camera Feed**: Live preview of camera recording (320x240)
- **Screen Recording**: Live preview of screen capture (480x270)
- **Audio Visualization**: Real-time waveform display of microphone input
- **Status Indicators**: Green/red indicators showing recording status
- **Controls**: Stop button and status messages

## Output Files

- `audio.wav` - Audio recording
- `camera.mp4` - Camera video recording
- `screen.mp4` - Screen recording

## Configuration

You can modify the following parameters in `main.py`:

- `CAMERA_INDEX`: Camera device index (default: 0)
- `SCREEN_WIDTH/HEIGHT`: Screen recording resolution (default: 1920x1080)
- `VIDEO_FPS`: Frame rate for video recordings (default: 30)
- `RATE`: Audio sample rate (default: 16000)
- `PREVIEW_WIDTH/HEIGHT`: Camera preview size (default: 320x240)
- `SCREEN_PREVIEW_WIDTH/HEIGHT`: Screen preview size (default: 480x270)

## Dependencies

The virtual environment includes:
- `pyaudio` - Audio recording
- `opencv-python` - Video processing and camera access
- `mss` - Screen capture
- `numpy` - Numerical computing
- `matplotlib` - Audio visualization
- `tkinter` - GUI framework (included with Python)

## Notes

- The script uses threading to record all streams simultaneously
- Screen recording may require additional permissions on some systems
- Camera access may require camera permissions
- All recordings are synchronized to start and stop together
- The visual interface updates every 50ms for smooth preview
- Audio visualization shows real-time waveform data
