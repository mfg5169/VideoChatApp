

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
  const accessToken = localStorage.getItem('access_token');
  const user = JSON.parse(sessionStorage.getItem('user'));
  
  async function handleCreateMeeting() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); 

    try {
      // Import and use the API client
      const { default: apiClient } = await import('../utils/api-client.js');
      

      
      const response = await apiClient.post('/meeting/create', {
        MeetingName: meetingName
      }, {
        signal: controller.signal,
        credentials: 'same-origin'
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server error response:', errorText);
        throw new Error(`Server error: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      clearTimeout(timeoutId); // Clear the timeout
      console.log('Meeting created:', data);
      
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
      
    } catch (err) {
      clearTimeout(timeoutId); // Clear the timeout
      console.error('Error creating meeting:', err);
      
      if (err.name === 'AbortError') {
        alert('Request timed out. Please check your connection and try again.');
      } else {
        alert('Failed to create meeting. Please try again.');
      }
      
      throw err; // Re-throw to be caught by the outer catch
    }
  }

  handleCreateMeeting().catch(err => {
    console.error('Error in handleCreateMeeting:', err);
    
    // Re-enable the create meeting button (this will always run)
    const createButton = document.querySelector('button[onclick="createNewMeeting()"]');
    if (createButton) {
      createButton.disabled = false;
      createButton.textContent = 'Create Meeting';
      createButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
    // Don't show duplicate alert since inner catch already shows one
    if (!err.message) {
      alert('Failed to create meeting. Please try again.');
    }
  });
}

// Start a new meeting (legacy function - now opens modal)
function startNewMeeting() {
  openNewMeetingModal();
}

// Join an existing meeting
async function joinMeeting() {
  const meetingId = document.getElementById('meetingId').value.trim();
  
  if (!meetingId) {
    alert('Please enter a meeting ID');
    return;
  }

  try {
    // Import the API client
    const { default: apiClient } = await import('../utils/api-client.js');
    
    console.log('Making join request to:', '/meeting/join');
    console.log('Request data:', { meetingId: meetingId });
    
    const response = await apiClient.post('/meeting/join', {
      meetingId: meetingId
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    // Check if the response is successful
    if (!response.ok) {
      const errorData = await response.json();
      console.log('Error data:', errorData);
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const data = await response.json();

    // Validate that we got the required data
    if (!data.meetingID || !data.meetingName) {
      throw new Error('Invalid meeting data received from server');
    }

    // Store meeting data in session storage
    sessionStorage.setItem('meetingName', data.meetingName);
    sessionStorage.setItem('meetingId', data.meetingID);
    sessionStorage.setItem('assignedSfuId', data.sfu);
    sessionStorage.setItem('assignedSignalingServerUrl', data.signalingServer);

    console.log("Join Meeting: ", data);
    
    // Navigate to meeting
    window.location.href = `../meeting/index.html?meetingId=${data.meetingID}`;
  } catch (err) {
    console.error("Join Meeting: ", err);
    alert(`Failed to join meeting: ${err.message}`);
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