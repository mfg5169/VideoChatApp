// Remote participant management
class ParticipantsManager {
  constructor() {
    this.remoteVideoElements = new Map();
    this.remoteParticipants = new Map();
    this.onParticipantAddedCallback = null;
    this.onParticipantRemovedCallback = null;
  }

  setCallbacks(callbacks) {
    this.onParticipantAddedCallback = callbacks.onParticipantAdded;
    this.onParticipantRemovedCallback = callbacks.onParticipantRemoved;
  }

  addRemoteVideo(peerId, stream, participantName = 'Unknown') {
    if (window.Logger) {
      window.Logger.info('REMOTE', 'Adding remote video participant', {
        peerId,
        participantName,
        streamTracks: stream.getTracks().length,
        existingVideoElements: this.remoteVideoElements.size
      });
    }
    
    let videoElement = this.remoteVideoElements.get(peerId);
    if (!videoElement) {
      if (window.Logger) {
        window.Logger.debug('REMOTE', 'Creating new video element for participant', { peerId, participantName });
      }
      
      // Create participant video container that matches the existing design
      const videoContainer = document.createElement('div');
      videoContainer.className = 'participant-video';
      videoContainer.id = `participant-${peerId}`;
      
      // Create video element
      videoElement = document.createElement('video');
      videoElement.autoplay = true;
      videoElement.playsInline = true;
      videoElement.className = 'w-full h-full object-cover';
      
      // Create participant info overlay
      const participantInfo = document.createElement('div');
      participantInfo.className = 'absolute bottom-2 left-2';
      participantInfo.innerHTML = `<h4 class="text-sm font-medium">${participantName}</h4>`;
      
      videoContainer.appendChild(videoElement);
      videoContainer.appendChild(participantInfo);
      
      // Add to video grid
      const videoGrid = document.getElementById('videoGrid');
      if (!videoGrid) {
        if (window.Logger) {
          window.Logger.error('REMOTE', 'Video grid element not found in DOM');
        }
        return;
      }
      
      videoGrid.appendChild(videoContainer);
      
      this.remoteVideoElements.set(peerId, videoElement);
      
      // Add to participants list
      this.addParticipantToList(peerId, participantName);
      
      // Update participant count
      this.updateParticipantCount();
      
      if (window.Logger) {
        window.Logger.info('REMOTE', 'Remote video element created and added to DOM', {
          peerId,
          participantName,
          totalRemoteVideos: this.remoteVideoElements.size
        });
      }
    } else {
      if (window.Logger) {
        window.Logger.debug('REMOTE', 'Updating existing video element', { peerId, participantName });
      }
    }
    
    videoElement.srcObject = stream;
    
    // Add to global state
    if (window.AppState) {
      window.AppState.remoteParticipants.set(peerId, { name: participantName, stream });
    }
    
    if (this.onParticipantAddedCallback) {
      this.onParticipantAddedCallback(peerId, participantName, stream);
    }
  }

  removeRemoteVideo(peerId) {
    if (window.Logger) {
      window.Logger.info('REMOTE', 'Removing remote video participant', { peerId });
    }
    
    const videoElement = this.remoteVideoElements.get(peerId);
    if (videoElement) {
      const videoContainer = videoElement.closest('.participant-video');
      if (videoContainer) {
        videoContainer.remove();
        if (window.Logger) {
          window.Logger.debug('REMOTE', 'Video container removed from DOM', { peerId });
        }
      }
      this.remoteVideoElements.delete(peerId);
      this.removeParticipantFromList(peerId);
      this.updateParticipantCount();
      
      // Remove from global state
      if (window.AppState) {
        window.AppState.remoteParticipants.delete(peerId);
      }
      
      if (window.Logger) {
        window.Logger.info('REMOTE', 'Remote video participant removed', {
          peerId,
          remainingParticipants: this.remoteVideoElements.size
        });
      }
      
      if (this.onParticipantRemovedCallback) {
        this.onParticipantRemovedCallback(peerId);
      }
    } else {
      if (window.Logger) {
        window.Logger.warn('REMOTE', 'Attempted to remove non-existent remote video', { peerId });
      }
    }
  }

  addParticipantToList(peerId, name) {
    if (this.remoteParticipants.has(peerId)) {
      if (window.Logger) {
        window.Logger.debug('PARTICIPANTS', 'Participant already in list, skipping', { peerId, name });
      }
      return;
    }
    
    if (window.Logger) {
      window.Logger.info('PARTICIPANTS', 'Adding participant to list', { peerId, name });
    }
    
    const participantsList = document.getElementById('participantsList');
    if (!participantsList) {
      if (window.Logger) {
        window.Logger.error('PARTICIPANTS', 'Participants list element not found in DOM');
      }
      return;
    }
    
    const participantElement = document.createElement('div');
    participantElement.className = 'flex items-center justify-between p-3 bg-gray-700 rounded-lg';
    participantElement.id = `participant-list-${peerId}`;
    
    const firstLetter = name.charAt(0).toUpperCase();
    const randomColor = `bg-${['blue', 'green', 'purple', 'red', 'yellow'][Math.floor(Math.random() * 5)]}-600`;
    
    participantElement.innerHTML = `
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 ${randomColor} rounded-full flex items-center justify-center">
          <span class="text-sm font-medium">${firstLetter}</span>
        </div>
        <div>
          <h4 class="font-medium text-sm">${name}</h4>
          <p class="text-xs text-gray-400">Participant</p>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <i class="fas fa-microphone text-green-500"></i>
        <i class="fas fa-video text-green-500"></i>
      </div>
    `;
    
    participantsList.appendChild(participantElement);
    this.remoteParticipants.set(peerId, { name, element: participantElement });
    
    if (window.Logger) {
      window.Logger.debug('PARTICIPANTS', 'Participant added to list successfully', {
        peerId,
        name,
        totalParticipants: this.remoteParticipants.size
      });
    }
  }

  removeParticipantFromList(peerId) {
    const participant = this.remoteParticipants.get(peerId);
    if (participant) {
      participant.element.remove();
      this.remoteParticipants.delete(peerId);
      if (window.Logger) {
        window.Logger.debug('PARTICIPANTS', 'Participant removed from list', { peerId });
      }
    } else {
      if (window.Logger) {
        window.Logger.warn('PARTICIPANTS', 'Attempted to remove non-existent participant from list', { peerId });
      }
    }
  }

  updateParticipantCount() {
    const count = 1 + this.remoteParticipants.size; // 1 for local user + remote participants
    const participantCountElement = document.getElementById('participantCount');
    if (participantCountElement) {
      participantCountElement.textContent = count.toString();
      if (window.Logger) {
        window.Logger.debug('PARTICIPANTS', 'Participant count updated', { count });
      }
    } else {
      if (window.Logger) {
        window.Logger.warn('PARTICIPANTS', 'Participant count element not found in DOM');
      }
    }
  }

  getParticipantCount() {
    return 1 + this.remoteParticipants.size;
  }

  getRemoteParticipants() {
    return Array.from(this.remoteParticipants.entries()).map(([id, data]) => ({
      id,
      name: data.name
    }));
  }

  cleanup() {
    if (window.Logger) {
      window.Logger.info('PARTICIPANTS', 'Cleaning up participant management');
    }
    
    const remoteVideoCount = this.remoteVideoElements.size;
    this.remoteVideoElements.forEach(video => {
      const container = video.closest('.participant-video');
      if (container) {
        container.remove();
      }
    });
    this.remoteVideoElements.clear();
    this.remoteParticipants.clear();
    
    if (window.Logger) {
      window.Logger.info('PARTICIPANTS', 'Participant management cleaned up', {
        remoteVideosRemoved: remoteVideoCount,
        participantsCleared: this.remoteParticipants.size
      });
    }
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParticipantsManager;
} else {
  window.ParticipantsManager = ParticipantsManager;
}
