// const refreshAccessToken = async () => {
//     const response = await fetch('/refresh-token', {
//       method: 'POST',
//       credentials: 'same-origin', // Ensure cookies are sent with the request
//     });
  
//     if (response.ok) {
//       const data = await response.json();
//       localStorage.setItem('access_token', data.access_token); // Update the access token
//     } else {
//       // Handle refresh token failure, e.g., log the user out
//       console.error('Unable to refresh access token');
//       // Optionally, redirect to login
//     }
//   };
// const baseUrl = 'http://localhost:3001';
const DockerUrl = 'http://localhost:8081';
async function refreshAccessToken() {
    const response = await fetch(`${baseUrl}/auth/refresh-token`, {
      method: 'POST',
      credentials: 'same-origin', // Ensure cookies are sent with the request
    });
  
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('access_token', data.access_token); // Update the access token
    } else {
      // Handle refresh token failure, e.g., log the user out
      console.error('Unable to refresh access token');
      // Optionally, redirect to login
    }
  }
  
    

  