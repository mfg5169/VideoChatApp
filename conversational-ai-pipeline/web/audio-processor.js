class AudioProcessor extends AudioWorkletProcessor {
  // This process method is called whenever a new chunk of audio data is available.
  process(inputs) {
    // We get the audio data from the first input.
    const input = inputs[0];
    
    // We only process if there is data in the input.
    if (input.length > 0) {
      // We use the first channel of the audio.
      const channelData = input[0];
      
      // We post the raw audio data (as a Float32Array buffer) back to the main script.
      // The second argument [channelData.buffer] is a list of "transferable" objects,
      // which transfers ownership of the buffer to the main thread efficiently without copying.
      this.port.postMessage(channelData.buffer, [channelData.buffer]);
    }
    
    // Return true to keep the processor alive.
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
