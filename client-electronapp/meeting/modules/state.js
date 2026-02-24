// Global state tracking
const AppState = {
  meetingId: null,
  userId: null,
  userName: null,
  signalingUrl: null,
  WSconnectionState: 'disconnected',
  peerConnectionState: 'new',
  localStreamState: 'not_initialized',
  remoteParticipants: new Map(),
  chatMessages: [],
  
  // UI state
  isAudioEnabled: true,
  isVideoEnabled: true,
  isScreenSharing: false,
  isSidebarOpen: false,
  currentSidebar: 'chat',
  
  updateState(newState) {
    Object.assign(this, newState);
    if (window.Logger) {
      window.Logger.info('STATE', 'Application state updated', this);
    }
  },
  
  getState() {
    return {
      meetingId: this.meetingId,
      userId: this.userId,
      userName: this.userName,
      signalingUrl: this.signalingUrl,
      WSconnectionState: this.WSconnectionState,
      peerConnectionState: this.peerConnectionState,
      localStreamState: this.localStreamState,
      remoteParticipantsCount: this.remoteParticipants.size,
      chatMessagesCount: this.chatMessages.length,
      isAudioEnabled: this.isAudioEnabled,
      isVideoEnabled: this.isVideoEnabled,
      isScreenSharing: this.isScreenSharing,
      isSidebarOpen: this.isSidebarOpen,
      currentSidebar: this.currentSidebar
    };
  },
  
  // Initialize state from session storage and URL params
  initialize() {
    const urlParams = new URLSearchParams(window.location.search);
    const meetingID = urlParams.get('meetingId') || urlParams.get('meetingID') || 'DEMO-123';
    const meetingName = sessionStorage.getItem('meetingName') || 'Meeting';
    const user = JSON.parse(sessionStorage.getItem('user'));
    // Ensure a stable ephemeral client ID if no authenticated user is present
    const storedId = sessionStorage.getItem('clientEphemeralId') || (() => {
      const id = 'client-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('clientEphemeralId', id);
      console.log('clientEphemeralId', id);
      return id;
    })();
    
    this.updateState({
      meetingId: meetingID,
      userId: user?.id || storedId,
      userName: user?.name || user?.email,
      signalingUrl: sessionStorage.getItem('assignedSignalingServerUrl')
    });
    
    return {
      meetingID,
      meetingName,
      user
    };
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AppState;
} else {
  window.AppState = AppState;
}
