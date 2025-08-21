// const baseUrl = 'http://localhost:3001';
const DockerUrl = 'http://localhost:8081';

// Handle form submission
document.getElementById('signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = document.getElementById('password').value;


    const passwordStrengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordStrengthRegex.test(password)) {
        //clearForm();
        alert('Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.');
        return;
    }


    

    const formData = JSON.stringify({
      username: document.getElementById('email').value,
      email: document.getElementById('email').value,
      password: password,
    })

    controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    console.log("Timeout ID: ", timeoutId);

    try {
      const res = await fetch(`${DockerUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log("res: ", res);

      if (res.status === 200 || res.status === 201) {
        const data = await res.json();
        console.log("Data: ", data);

        // Store the access token in localStorage (you can store it in sessionStorage if preferred)
        localStorage.setItem('access_token', data.accessToken);
        
        // Store the user info (optional)
        sessionStorage.setItem('user', JSON.stringify(data.user));

        // Redirect to the home page
        alert('Account logged in successfully!');
        window.location.href = '../../home/index.html'; // Or wherever the home page is located
        return;
      }
      else {
        alert(`${res.status}: ${res.statusText}`);
        return;
      }
    } catch (err) {
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