// Media stream management
class MediaManager {
  constructor() {
    this.localStream = null;
    this.localVideo = null;
    this.screenStream = null;
    this.screenVideo = null;
    this.onStreamReadyCallback = null;
    this.onStreamErrorCallback = null;
  }

  setCallbacks(callbacks) {
    this.onStreamReadyCallback = callbacks.onStreamReady;
    this.onStreamErrorCallback = callbacks.onStreamError;
  }

  async initializeVideoStreams() {
    if (window.Logger) {
      window.Logger.info('STREAM', 'Starting video stream initialization');
    }
    
    // Complex constraints for best quality video and audio
    const complexConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    };

    if (window.Logger) {
      window.Logger.debug('STREAM', 'Media constraints configured', complexConstraints);
      window.Logger.info('STREAM', 'Requesting user media access...');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(complexConstraints);
      
      if (window.Logger) {
        window.Logger.info('STREAM', 'User media access granted', {
          audioTracks: stream.getAudioTracks().length,
          videoTracks: stream.getVideoTracks().length,
          trackIds: stream.getTracks().map(track => ({
            kind: track.kind,
            id: track.id,
            enabled: track.enabled,
            muted: track.muted
          }))
        });
      }
      
      this.localVideo = document.getElementById('mainVideo');
      if (!this.localVideo) {
        throw new Error('Main video element not found in DOM');
      }
      
      this.localVideo.srcObject = stream;
      this.localStream = stream;
      
      if (window.AppState) {
        window.AppState.updateState({ localStreamState: 'active' });
      }
      
      if (window.Logger) {
        window.Logger.info('STREAM', 'Local video stream attached to DOM element');
      }
      
      if (this.onStreamReadyCallback) {
        this.onStreamReadyCallback(stream);
      }
      
    } catch (err) {
      if (window.Logger) {
        window.Logger.error('STREAM', 'Failed to access user media devices', err, {
          constraints: complexConstraints,
          errorName: err.name,
          errorMessage: err.message
        });
      }
      
      if (window.AppState) {
        window.AppState.updateState({ localStreamState: 'failed' });
      }
      
      if (this.onStreamErrorCallback) {
        this.onStreamErrorCallback(err);
      }
      
      // Show user-friendly error message
      alert(`Failed to access camera/microphone: ${err.message}`);
    }
  }

  async getSharedScreenStream() {
    if (window.Logger) {
      window.Logger.info('SCREEN', 'Requesting screen sharing sources');
    }
    
    try {
      if (window.Logger) {
        window.Logger.info('SCREEN', 'Requesting sources...');
      }
      
      const sources = await window.electronAPI.getScreenSources();
      
      if (window.Logger) {
        window.Logger.info('SCREEN', 'Screen sources retrieved', {
          sourceCount: sources.length,
          sources: sources.map(s => ({ id: s.id, name: s.name, thumbnail: !!s.thumbnail }))
        });
      }

      const source = sources[1];
      if (!source) {
        throw new Error('No screen source available');
      }

      if (window.Logger) {
        window.Logger.info('SCREEN', 'Selected screen source', { 
          sourceId: source.id, 
          sourceName: source.name 
        });
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
          }
        }
      });

      if (window.Logger) {
        window.Logger.info('SCREEN', 'Screen sharing stream obtained', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length
        });
      }

      this.screenVideo = document.getElementById('screenVideo');
      this.screenVideo.srcObject = stream;
      this.screenVideo.play();
      this.screenStream = stream;
      
      if (window.Logger) {
        window.Logger.info('SCREEN', 'Screen sharing video attached to DOM');
      }
      
      return stream;
      
    } catch (err) {
      if (window.Logger) {
        window.Logger.error('SCREEN', 'Error accessing screen stream', err);
      }
      throw err;
    }
  }

  toggleAudio(enabled) {
    if (!this.localStream) {
      if (window.Logger) {
        window.Logger.warn('MEDIA', 'No local stream available for audio toggle');
      }
      return;
    }

    const audioTracks = this.localStream.getAudioTracks();
    audioTracks.forEach(track => {
      track.enabled = enabled;
      if (window.Logger) {
        window.Logger.debug('MEDIA', 'Audio track toggled', {
          trackId: track.id,
          enabled: track.enabled
        });
      }
    });

    if (window.AppState) {
      window.AppState.updateState({ isAudioEnabled: enabled });
    }
  }

  toggleVideo(enabled) {
    if (!this.localStream) {
      if (window.Logger) {
        window.Logger.warn('MEDIA', 'No local stream available for video toggle');
      }
      return;
    }

    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach(track => {
      track.enabled = enabled;
      if (window.Logger) {
        window.Logger.debug('MEDIA', 'Video track toggled', {
          trackId: track.id,
          enabled: track.enabled
        });
      }
    });

    if (this.localVideo) {
      this.localVideo.style.display = enabled ? 'block' : 'none';
    }

    if (window.AppState) {
      window.AppState.updateState({ isVideoEnabled: enabled });
    }
  }

  toggleScreenSharing(enabled) {
    if (window.Logger) {
      window.Logger.info('SCREEN', `Screen sharing toggled: ${enabled}`);
    }

    const screenVideo = document.getElementById('screenVideo');
    const videoGrid = document.getElementById('videoGrid');
    
    if (enabled) {
      screenVideo.classList.remove('hidden');
      videoGrid.classList.add('hidden');
    } else {
      screenVideo.classList.add('hidden');
      videoGrid.classList.remove('hidden');
    }

    if (window.AppState) {
      window.AppState.updateState({ isScreenSharing: enabled });
    }
  }

  getLocalStream() {
    return this.localStream;
  }

  getScreenStream() {
    return this.screenStream;
  }

  cleanup() {
    if (window.Logger) {
      window.Logger.info('MEDIA', 'Cleaning up media streams');
    }
    
    try {
      if (this.localStream) {
        const trackCount = this.localStream.getTracks().length;
        this.localStream.getTracks().forEach(track => {
          if (window.Logger) {
            window.Logger.debug('MEDIA', 'Stopping local track', {
              trackKind: track.kind,
              trackId: track.id
            });
          }
          track.stop();
        });
        this.localStream = null;
        if (window.Logger) {
          window.Logger.info('MEDIA', 'Local stream tracks stopped', { trackCount });
        }
      }
      
      if (this.localVideo) {
        this.localVideo.srcObject = null;
        if (window.Logger) {
          window.Logger.debug('MEDIA', 'Local video element cleared');
        }
      }

      if (this.screenStream) {
        this.screenStream.getTracks().forEach(track => track.stop());
        this.screenStream = null;
        if (window.Logger) {
          window.Logger.info('MEDIA', 'Screen stream stopped');
        }
      }

      if (this.screenVideo) {
        this.screenVideo.srcObject = null;
      }
      
      if (window.AppState) {
        window.AppState.updateState({ 
          localStreamState: 'cleaned',
          isScreenSharing: false
        });
      }
      
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('MEDIA', 'Error during media cleanup', error);
      }
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MediaManager;
} else {
  window.MediaManager = MediaManager;
}
