// WebRTC connection management
class WebRTCManager {
  constructor() {
    this.peerConnection = null;
    this.remoteIceCandidates = [];
    this.stunServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.localStream = null;
    this.onTrackCallback = null;
    this.onConnectionStateChangeCallback = null;
    this.onNegotiationNeededCallback = null;
    this.onIceCandidateCallback = null;
  }

  setCallbacks(callbacks) {
    this.onTrackCallback = callbacks.onTrack;
    this.onConnectionStateChangeCallback = callbacks.onConnectionStateChange;
    this.onNegotiationNeededCallback = callbacks.onNegotiationNeeded;
    this.onIceCandidateCallback = callbacks.onIceCandidate;
  }

  createPeerConnection(localStream) {
    if (window.Logger) {
      window.Logger.info('WEBRTC', 'Creating new PeerConnection', {
        stunServers: this.stunServers,
        localStreamTracks: localStream ? localStream.getTracks().length : 0
      });
    }

    try {
      this.peerConnection = new RTCPeerConnection({ iceServers: this.stunServers });
      this.localStream = localStream;
      
      if (window.Logger) {
        window.Logger.info('WEBRTC', 'PeerConnection created successfully');
      }

      // Add local tracks to peer connection
      if (localStream) {
        localStream.getTracks().forEach(track => {
          this.peerConnection.addTrack(track, localStream);
          if (window.Logger) {
            window.Logger.debug('WEBRTC', 'Local track added to PeerConnection', {
              trackKind: track.kind,
              trackId: track.id,
              trackEnabled: track.enabled
            });
          }
        });
        if (window.Logger) {
          window.Logger.info('WEBRTC', 'All local stream tracks added to PeerConnection');
        }
      } else {
        if (window.Logger) {
          window.Logger.warn('WEBRTC', 'No local stream available when creating PeerConnection');
        }
      }

      // Set up event handlers
      this.setupEventHandlers();

      if (window.Logger) {
        window.Logger.info('WEBRTC', 'PeerConnection event handlers configured successfully');
      }
      
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('WEBRTC', 'Failed to create PeerConnection', error);
      }
      throw error;
    }
  }

  setupEventHandlers() {
    // ICE candidate handling
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        if (window.Logger) {
          window.Logger.debug('WEBRTC', 'ICE candidate generated', {
            candidateType: event.candidate.type,
            candidateProtocol: event.candidate.protocol,
            candidateAddress: event.candidate.address
          });
        }
        if (this.onIceCandidateCallback) {
          this.onIceCandidateCallback(event.candidate);
        }
      } else {
        if (window.Logger) {
          window.Logger.info('WEBRTC', 'ICE candidate gathering complete');
        }
      }
    };

    // Remote track handling
    this.peerConnection.ontrack = (event) => {
      if (window.Logger) {
        window.Logger.info('WEBRTC', 'Remote track received', {
          trackKind: event.track.kind,
          trackId: event.track.id,
          streamId: event.streams[0]?.id
        });
      }
      
      const remoteStream = event.streams[0];
      if (remoteStream && this.onTrackCallback) {
        this.onTrackCallback(event);
      } else {
        if (window.Logger) {
          window.Logger.warn('WEBRTC', 'Remote track received but no stream available');
        }
      }
    };

    // Connection state change handling
    this.peerConnection.onconnectionstatechange = () => {
      const newState = this.peerConnection.connectionState;
      if (window.Logger) {
        window.Logger.info('WEBRTC', 'PeerConnection state changed', {
          newState: newState
        });
      }
      
      if (window.AppState) {
        window.AppState.updateState({ peerConnectionState: newState });

      if (newState === 'connected') {
        if (window.Logger) {
          window.Logger.info('WEBRTC', '🎉 PeerConnection successfully established!', {
            connectionState: newState
          });
        }
      }
      }
      
      if (this.onConnectionStateChangeCallback) {
        this.onConnectionStateChangeCallback(newState);
      }
      
      if (newState === 'disconnected' || newState === 'failed' || newState === 'closed') {
        if (window.Logger) {
          window.Logger.warn('WEBRTC', 'PeerConnection disconnected or failed, cleaning up');
        }
        this.cleanup();
      }
    };

    // Negotiation needed handling
    this.peerConnection.onnegotiationneeded = async () => {
      if (window.Logger) {
        window.Logger.info('WEBRTC', 'Negotiation needed, creating offer');
      }
      
      if (this.onNegotiationNeededCallback) {
        await this.onNegotiationNeededCallback();
      }
    };
  }

  async handleSignalingMessage(message) {
    if (window.Logger) {
      // Enhanced logging to see the raw incoming message
      window.Logger.info('WEBRTC_INCOMING', 'Received full signaling message object from server', {
        fullMessage: message
      });
      window.Logger.debug('WEBRTC', 'Processing WebRTC signaling message', {
        type: message.type,
        hasPayload: !!message.payload
      });
    }

    try {
      if (!this.peerConnection) {
        if (window.Logger) {
          window.Logger.warn('WEBRTC', 'PeerConnection not initialized, ignoring WebRTC message', {
            type: message.type
          });
        }
        return;
      }

      if (message.type === 'answer') {
        if (window.Logger) {
          window.Logger.info('WEBRTC_INCOMING', 'Processing ANSWER from SFU', { payload: message.payload });
        }
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
          if (window.Logger) {
            window.Logger.info('WEBRTC', 'Remote description set from answer');
          }
        } catch (error) {
          if (window.Logger) {
            window.Logger.error('WEBRTC', 'Error setting remote description for ANSWER', error, { payload: message.payload });
          }
        }
        
        // Process buffered ICE candidates
        await this.processBufferedCandidates();
        
      } else if (message.type === 'offer') {
        if (window.Logger) {
          window.Logger.info('WEBRTC', 'Received renegotiation offer from SFU');
        }
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        await this.processBufferedCandidates();
        
        if (this.onIceCandidateCallback) {
          this.onIceCandidateCallback({ type: 'answer', sdp: answer.sdp });
        }
        
        if (window.Logger) {
          window.Logger.info('WEBRTC', 'Renegotiation answer sent to SFU');
        }
        
      } else if (message.type === 'candidate') {
        if (window.Logger) {
          window.Logger.info('WEBRTC_INCOMING', 'Processing CANDIDATE from SFU', { payload: message.payload });
        }
        await this.addIceCandidate(message.payload);
      }
      
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('WEBRTC', 'Error handling WebRTC signaling message', error, {
          messageType: message.type,
          messagePayload: message.payload
        });
      }
    }
  }

  async addIceCandidate(candidate) {
    try {
      if (this.peerConnection && this.peerConnection.remoteDescription) {
        if (window.Logger) {
          window.Logger.debug('WEBRTC', 'Attempting to add ICE candidate now', { candidate });
        }
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        if (window.Logger) {
          window.Logger.debug('WEBRTC', 'ICE candidate added to PeerConnection');
        }
      } else {
        this.remoteIceCandidates.push(candidate);
        if (window.Logger) {
          window.Logger.debug('WEBRTC', 'ICE candidate buffered', { 
            bufferedCount: this.remoteIceCandidates.length,
            hasPeerConnection: !!this.peerConnection,
            hasRemoteDescription: !!(this.peerConnection && this.peerConnection.remoteDescription)
          });
        }
      }
    } catch (error) {
      if (window.Logger) {
        window.Logger.error('WEBRTC', 'Error adding received ICE candidate', error, {
          payload: candidate
        });
      }
    }
  }

  async processBufferedCandidates() {
    if (window.Logger) {
      window.Logger.info('WEBRTC', 'About to process buffered ICE candidates', { count: this.remoteIceCandidates.length });
    }
    while (this.remoteIceCandidates.length > 0) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(this.remoteIceCandidates.shift()));
    }
    if (window.Logger) {
      window.Logger.info('WEBRTC', 'Processed buffered ICE candidates', { count: this.remoteIceCandidates.length });
    }
  }

  async createOffer() {
    if (!this.peerConnection) {
      throw new Error('PeerConnection not initialized');
    }
    
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    if (window.Logger) {
      window.Logger.info('WEBRTC', 'Local description set, sending offer to signaling server');
    }
    
    return offer;
  }

  cleanup() {
    if (this.peerConnection) {
      const previousState = this.peerConnection.connectionState;
      this.peerConnection.close();
      this.peerConnection = null;
      if (window.Logger) {
        window.Logger.info('WEBRTC', 'PeerConnection closed', { previousState });
      }
    }
    
    this.remoteIceCandidates = [];
    this.localStream = null;
    
    if (window.AppState) {
      window.AppState.updateState({ 
        peerConnectionState: 'closed',
        WSconnectionState: 'disconnected'
      });
    }
  }

  getConnectionState() {
    return this.peerConnection ? this.peerConnection.connectionState : 'not_created';
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebRTCManager;
} else {
  window.WebRTCManager = WebRTCManager;
}
