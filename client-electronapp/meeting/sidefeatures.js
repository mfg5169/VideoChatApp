    // Toggle chat sidebar
    function toggleChat() {
        if (currentSidebar === 'chat' && isSidebarOpen) {
          closeSidebar();
        } else {
          openSidebar('chat');
        }
      }
      
      // Toggle participants sidebar
      function toggleParticipants() {
        if (currentSidebar === 'participants' && isSidebarOpen) {
          closeSidebar();
        } else {
          openSidebar('participants');
        }
      }
      
      // Open sidebar
      function openSidebar(type) {
        const sidebar = document.getElementById('sidebar');
        const chatSection = document.getElementById('chatSection');
        const participantsSection = document.getElementById('participantsSection');
        const sidebarTitle = document.getElementById('sidebarTitle');
        
        currentSidebar = type;
        isSidebarOpen = true;
        
        if (type === 'chat') {
          sidebarTitle.textContent = 'Chat';
          chatSection.classList.remove('hidden');
          participantsSection.classList.add('hidden');
        } else if (type === 'participants') {
          sidebarTitle.textContent = 'Participants';
          chatSection.classList.add('hidden');
          participantsSection.classList.remove('hidden');
        }
        
        sidebar.classList.remove('hidden');
      }
      
      // Close sidebar
      function closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.add('hidden');
        isSidebarOpen = false;
      }
      
      // Toggle settings modal
      function toggleSettings() {
        const modal = document.getElementById('settingsModal');
        modal.classList.toggle('hidden');
      }
      
      // Toggle more options
      function toggleMoreOptions() {
        // Placeholder for more options menu
        alert('More options coming soon!');
      }
          // Toggle audio
    function toggleAudio() {
        isAudioEnabled = !isAudioEnabled;
        const audioBtn = document.getElementById('audioBtn');
        const mainVideo = document.getElementById('mainVideo');
        
        if (isAudioEnabled) {
          audioBtn.innerHTML = '<i class="fas fa-microphone text-lg"></i>';
          audioBtn.className = 'control-button primary';
          // Enable audio track if stream exists
          if (mainVideo && mainVideo.srcObject) {
            window.meetingHelper.toggleAudioStream(mainVideo.srcObject, true);
          }
        } else {
          audioBtn.innerHTML = '<i class="fas fa-microphone-slash text-lg"></i>';
          audioBtn.className = 'control-button danger';
          // Disable audio track if stream exists
          if (mainVideo && mainVideo.srcObject) {
            window.meetingHelper.toggleAudioStream(mainVideo.srcObject, false);
          }
        }
      }
      
      // Toggle video
      function toggleVideo() {
        isVideoEnabled = !isVideoEnabled;
        const videoBtn = document.getElementById('videoBtn');
        const mainVideo = document.getElementById('mainVideo');
        
        if (isVideoEnabled) {
          videoBtn.innerHTML = '<i class="fas fa-video text-lg"></i>';
          videoBtn.className = 'control-button primary';
          mainVideo.style.display = 'block';
        } else {
          videoBtn.innerHTML = '<i class="fas fa-video-slash text-lg"></i>';
          videoBtn.className = 'control-button danger';
          mainVideo.style.display = 'none';
        }
      }
      
      // Toggle screen sharing
      function toggleScreenShare() {
        isScreenSharing = !isScreenSharing;
        const screenShareBtn = document.getElementById('screenShareBtn');
        const screenVideo = document.getElementById('screenVideo');
        const videoGrid = document.getElementById('videoGrid');
        
        if (isScreenSharing) {
          screenShareBtn.innerHTML = '<i class="fas fa-stop text-lg"></i>';
          screenShareBtn.className = 'control-button danger';
          screenVideo.classList.remove('hidden');
          videoGrid.classList.add('hidden');
        } else {
          screenShareBtn.innerHTML = '<i class="fas fa-desktop text-lg"></i>';
          screenShareBtn.className = 'control-button secondary';
          screenVideo.classList.add('hidden');
          videoGrid.classList.remove('hidden');
        }
      }
    
      
          // Chat functionality is now handled in meeting-sfu.js
          // This function is kept for backward compatibility but delegates to the new implementation
          function sendMessage() {
            if (typeof sendChatMessage === 'function') {
              sendChatMessage();
            }
          }
    
      
          // Go back to home
    function goBack() {
        window.location.href = '../home/index.html';
      }

          
    // Handle keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
          switch(e.key) {
            case 'd':
              e.preventDefault();
              toggleAudio();
              break;
            case 'e':
              e.preventDefault();
              toggleVideo();
              break;
            case 's':
              e.preventDefault();
              toggleScreenShare();
              break;
            case 'h':
              e.preventDefault();
              toggleChat();
              break;
          }
        }
      });
  // Leave meeting
function leaveMeeting() {
    if (confirm('Are you sure you want to leave the meeting?')) {
      closeStream();
      window.location.href = '../home/index.html';
    }
  }
  