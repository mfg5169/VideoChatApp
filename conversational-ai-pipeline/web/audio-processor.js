class AudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    
    if (input.length > 0) {
      const channelData = input[0];
      
      this.port.postMessage(channelData.buffer, [channelData.buffer]);
    }
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
