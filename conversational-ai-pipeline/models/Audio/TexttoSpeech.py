from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from elevenlabs import play
import os

load_dotenv()

print(os.getenv("ELEVENLABS"))
elevenlabs = ElevenLabs(
  api_key=os.getenv("ELEVENLABS"),
)
### Text to Speech
audio = elevenlabs.text_to_speech.convert(
    text="I'm mad at you.",
    voice_id="UgBBYS2sOqTuMpoF3BR0",
    model_id="eleven_flash_v2_5",
    output_format="mp3_44100_128",
)

play(audio)

