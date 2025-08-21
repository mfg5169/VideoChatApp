

// Fetch data from a protected resource
// const response = await fetch('/protected-route', {
//   method: 'GET',
//   headers: {
//     'Authorization': `Bearer ${accessToken}` // Send access token in the header
//   },
//   credentials: 'same-origin' // Make sure cookies (like the refresh token) are sent with the request
// });

// if (response.ok) {
//   const data = await response.json();
//   console.log('Protected data:', data);
// } else {
//   console.error('Access denied');
// }
    // Load user data and set initials
    function loadUserData() {
      const userData = localStorage.getItem('userData');
      if (userData) {
        try {
          const user = JSON.parse(userData);
          const initials = user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase() : 'U';
          document.getElementById('userInitials').textContent = initials;
        } catch (error) {
          console.error('Error parsing user data:', error);
        }
      }
    }

    // Modal functions
    function openNewMeetingModal() {
      document.getElementById('newMeetingModal').classList.remove('hidden');
      document.getElementById('meetingName').focus();
    }

    function closeNewMeetingModal() {
      document.getElementById('newMeetingModal').classList.add('hidden');
      document.getElementById('meetingName').value = '';
    }

    // Create a new meeting with name
    function createNewMeeting() {
      const meetingName = document.getElementById('meetingName').value.trim();
      
      if (!meetingName) {
        alert('Please enter a meeting name');
        return;
      }

      // Disable the create meeting button
      const createButton = document.querySelector('button[onclick="createNewMeeting()"]');
      if (createButton) {
        createButton.disabled = true;
        createButton.textContent = 'Creating...';
        createButton.classList.add('opacity-50', 'cursor-not-allowed');
      }



      // const baseUrl = 'http://localhost:3001';
      const DockerUrl = 'http://localhost:8081';
      const accessToken = localStorage.getItem('access_token');
      const user = JSON.parse(sessionStorage.getItem('user'));
      function handleCreateMeeting() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); 

        fetch(`${DockerUrl}/meeting/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          credentials: 'same-origin',
          signal: controller.signal,
          body: JSON.stringify({ 
            MeetingID: meetingId,
            name: meetingName,
            MeetingName: user.id
          })
        })
        .then(async res => {
          if (!res.ok) {
            // Try to detect if it's an auth error (401 or 403)
            if (res.status === 401 || res.status === 403) {
              // Try to refresh the access token
              if (typeof refreshAccessToken === 'function') {
                await refreshAccessToken();
                // Try again after refreshing
                return fetch(`${DockerUrl}/meeting/join`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                  },
                  credentials: 'same-origin',
                  signal: controller.signal,
                  body: JSON.stringify({ 
                    MeetingID: meetingId,
                    name: meetingName,
                    MeetingName: user.id
                  })
                });
              }
            }
            throw new Error('Failed to create meeting');
          }
          return res;
        })
        .then(res => res.json())
        .then(data => {
          clearTimeout(timeoutId); // Clear the timeout
          console.log('Meeting created:', data);
          
          // Re-enable the create meeting button
          const createButton = document.querySelector('button[onclick="createNewMeeting()"]');
          if (createButton) {
            createButton.disabled = false;
            createButton.textContent = 'Create Meeting';
            createButton.classList.remove('opacity-50', 'cursor-not-allowed');
          }
          
          closeNewMeetingModal();
          // Store the returned sfu and signaling server in session storage
          if (data.sfu) {
            sessionStorage.setItem('assignedSfuId', data.sfu);
          }
          if (data.signalingServer) {
            sessionStorage.setItem('assignedSignalingServerUrl', data.signalingServer);
          }
          sessionStorage.setItem('meetingName', meetingName);
          sessionStorage.setItem('meetingId', data.meetingID);
          window.location.href = `../meeting/index.html?meetingID=${data.meetingID}`;
        })
        .catch(err => {
          clearTimeout(timeoutId); // Clear the timeout
          console.error('Error creating meeting:', err);
          
          // Re-enable the create meeting button
          const createButton = document.querySelector('button[onclick="createNewMeeting()"]');
          if (createButton) {
            createButton.disabled = false;
            createButton.textContent = 'Create Meeting';
            createButton.classList.remove('opacity-50', 'cursor-not-allowed');
          }
          
          if (err.name === 'AbortError') {
            alert('Request timed out. Please check your connection and try again.');
          } else {
            alert('Failed to create meeting. Please try again.');
          }
        });
      }

      handleCreateMeeting();
    }

    // Start a new meeting (legacy function - now opens modal)
    function startNewMeeting() {
      openNewMeetingModal();
    }

    // Join an existing meeting
    function joinMeeting() {
      const meetingId = document.getElementById('meetingId').value.trim();
      if (meetingId) {
        window.location.href = `../meeting/index.html?meetingId=${meetingId}`;
      } else {
        alert('Please enter a meeting ID');
      }
    }

    // Schedule a meeting (placeholder)
    function scheduleMeeting() {
      alert('Schedule meeting functionality coming soon!');
    }

    // Logout function
    function logout() {
      // Remove tokens from storage
      localStorage.removeItem('access_token');
      localStorage.removeItem('userData');
      sessionStorage.removeItem('authToken');

      // Clear refresh_token cookie (if exists)
      document.cookie = "refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

      window.location.href = '../auth/signin/index.html';
    }

    // Load user data when page loads
    document.addEventListener('DOMContentLoaded', function() {
      loadUserData();
    });