// TEST: Basic console test for signin helper.js
console.log('🚀 SIGNIN HELPER.JS LOADED - Console test');
console.log('🚀 Current time:', new Date().toISOString());
console.log('🚀 Current URL:', window.location.href);

// const baseUrl = 'http://localhost:3001';
const DockerUrl = 'http://localhost:8081';

// Handle form submission
document.getElementById('signinForm').addEventListener('submit', async (e) => {
    console.log('🔍 Signin form submitted');
    e.preventDefault();
    
    const password = document.getElementById('password').value;
    const email = document.getElementById('email').value;
    
    console.log('🔍 Form data - Email:', email);
    console.log('🔍 Form data - Password length:', password.length);

    const passwordStrengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordStrengthRegex.test(password)) {
        console.warn('⚠️ Password strength validation failed');
        //clearForm();
        alert('Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.');
        return;
    }

    console.log('✅ Password strength validation passed');


    

    const formData = JSON.stringify({
      username: document.getElementById('email').value,
      email: document.getElementById('email').value,
      password: password,
    })

    controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    console.log("Timeout ID: ", timeoutId);

    try {
      console.log('🔍 Making login request to:', `${DockerUrl}/auth/login`);
      const res = await fetch(`${DockerUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log('🔍 Login response status:', res.status);

      if (res.status === 200 || res.status === 201) {
        const data = await res.json();
        console.log('✅ Login successful, data received:', data);

        // Store the access token in localStorage (you can store it in sessionStorage if preferred)
        localStorage.setItem('access_token', data.accessToken);
        console.log('💾 Access token stored in localStorage');
        
        // Store the user info (optional)
        sessionStorage.setItem('user', JSON.stringify(data.user));
        console.log('💾 User data stored in sessionStorage');

        // Redirect to the home page
        alert('Account logged in successfully!');
        console.log('🔄 Redirecting to home page...');
        window.location.href = '../../home/index.html'; // Or wherever the home page is located
        return;
      }
      else {
        console.error('❌ Login failed with status:', res.status, res.statusText);
        alert(`${res.status}: ${res.statusText}`);
        return;
      }
    } catch (err) {
      console.error('❌ Login request failed:', err);
      alert('Error logging in: ' + err.message);
      console.error('Error uploading image:', err);
    }
    // Here you would typically send the form data to your backend

    //clearForm();
        
    // For now, just Lo a success message
    console.log("Account logged in successfully!");
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';

    // window.location.href = '../signin/index.html';
    
      });