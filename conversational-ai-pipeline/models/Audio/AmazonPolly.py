# Import required libraries
import boto3
import os
import time
import json
import tempfile
import subprocess
import platform

# Create a client for Amazon Polly
polly_client = boto3.client('polly')

# Create output directory if it doesn't exist
output_dir = "audio_output"
if not os.path.exists(output_dir):
    os.makedirs(output_dir)


def synthesize_speech(text, voice_id, engine="standard", output_format="mp3", text_type="text"):
    """
    Synthesize speech using Amazon Polly and return the audio stream.
    
    Parameters:
    - text: The text to convert to speech
    - voice_id: The voice to use (e.g., 'Joanna', 'Matthew')
    - engine: The engine to use ('standard', 'neural', or 'long-form')
    - output_format: The output format ('mp3', 'ogg_vorbis', or 'pcm')
    - text_type: The type of input text ('text' or 'ssml')
    
    Returns:
    - Audio stream
    """
    try:
        response = polly_client.synthesize_speech(
            Text=text,
            VoiceId=voice_id,
            Engine=engine,
            OutputFormat=output_format,
            TextType=text_type
        )
        return response['AudioStream'].read()
    except Exception as e:
        print(f"Error synthesizing speech: {str(e)}")
        return None
    

def play_audio(audio_data, format="mp3"):
    """
    Play audio data using system audio player.
    
    Parameters:
    - audio_data: The audio data to play
    - format: The format of the audio data
    """
    if not audio_data:
        print("No audio data to play")
        return False
    
    try:
        # Create a temporary file
        with tempfile.NamedTemporaryFile(suffix=f".{format}", delete=False) as temp_file:
            temp_file.write(audio_data)
            temp_file_path = temp_file.name
        
        # Play audio based on the operating system
        system = platform.system()
        
        if system == "Darwin":  # macOS
            subprocess.run(["afplay", temp_file_path], check=True)
        elif system == "Linux":
            # Try different audio players
            players = ["aplay", "paplay", "mpg123", "ffplay"]
            for player in players:
                try:
                    subprocess.run([player, temp_file_path], check=True)
                    break
                except (subprocess.CalledProcessError, FileNotFoundError):
                    continue
            else:
                print("No audio player found. Install one of: aplay, paplay, mpg123, ffplay")
                return False
        elif system == "Windows":
            subprocess.run(["start", temp_file_path], shell=True, check=True)
        else:
            print(f"Unsupported operating system: {system}")
            return False
        
        # Clean up temporary file
        os.unlink(temp_file_path)
        return True
        
    except Exception as e:
        print(f"Error playing audio: {str(e)}")
        return False


def save_audio_file(audio_data, filename, output_dir="audio_output"):
    """
    Save audio data to a file.
    
    Parameters:
    - audio_data: The audio data to save
    - filename: The name of the file to save
    - output_dir: The directory to save the file in
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    file_path = os.path.join(output_dir, filename)
    
    try:
        with open(file_path, 'wb') as file:
            file.write(audio_data)
        print(f"Audio saved to: {file_path}")
        return file_path
    except Exception as e:
        print(f"Error saving audio file: {str(e)}")
        return None


# Get the list of available voices
response = polly_client.describe_voices()

# Create dictionaries to store voices by engine type
standard_voices = []
neural_voices = []
long_form_voices = []
generative_voices = []

# Categorize voices by supported engine
for voice in response['Voices']:
    voice_info = {
        'Id': voice['Id'],
        'LanguageCode': voice['LanguageCode'],
        'Gender': voice['Gender']
    }
    
    supported_engines = voice.get('SupportedEngines', [])
    
    if 'standard' in supported_engines:
        standard_voices.append(voice_info)
    
    if 'neural' in supported_engines:
        neural_voices.append(voice_info)
        
    if 'long-form' in supported_engines:
        long_form_voices.append(voice_info)
    
    if 'generative' in supported_engines:
        generative_voices.append(voice_info)

print(f"Available Standard Voices: {len(standard_voices)}")
print(f"Available Neural Voices: {len(neural_voices)}")
print(f"Available Long-form Voices: {len(long_form_voices)}")
print(f"Available Generative Voices: {len(generative_voices)}")


# Show the first 5 neural and generative voices as examples
print("\nSample Neural Voices:")
for voice in neural_voices[:5]:
    print(f"ID: {voice['Id']}, Language: {voice['LanguageCode']}, Gender: {voice['Gender']}")

print("\nSample Generative Voices:")
for voice in generative_voices[:5]:
    print(f"ID: {voice['Id']}, Language: {voice['LanguageCode']}, Gender: {voice['Gender']}")

# Sample text to synthesize
sample_text = "I'm mad at you."

# Example with US English female voice (Joanna)
standard_audio_joanna = synthesize_speech(
    text=sample_text,
    voice_id="Joanna",
    engine="standard",
    output_format="mp3",
    text_type="text"
)

# Save the audio
save_audio_file(standard_audio_joanna, "standard_joanna.mp3")

# Play the audio
print("Playing audio...")
play_audio(standard_audio_joanna)


# Sample text to synthesize
sample_text = "Hello, welcome to this demonstration of Amazon Polly. This is the generative engine, which produces the most natural-sounding speech."

# Example with US English female voice (Joanna)
generative_audio_joanna = synthesize_speech(
    text=sample_text,
    voice_id="Joanna",
    engine="generative",
    output_format="mp3",
    text_type="text"
)

# Save the audio
# save_audio_file(generative_audio_joanna, "generative_joanna.mp3")

# Play the audio
# Basic SSML with pauses
ssml_text = """<speak>
    Hello! <break time='1s'/> Welcome to Amazon Polly. 
    This is a demonstration of SSML, which allows for <prosody rate='slow'>slower speech</prosody> 
    or <prosody rate='fast'>faster speech</prosody>, and even 
    <prosody volume='loud'>loud volume</prosody> or <prosody volume='soft'>soft volume</prosody>.
</speak>"""

ssml_audio = synthesize_speech(
    text=ssml_text,
    voice_id="Joanna",
    engine="neural",
    text_type="ssml"
)
# save_audio_file(ssml_audio, "ssml_demo.mp3")
play_audio(ssml_audio)