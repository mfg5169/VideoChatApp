  // Handle profile picture preview
const baseUrl = 'http://localhost:3001';
const profilePictureInput = document.getElementById('profilePicture');
const imagePreview = document.getElementById('imagePreview');
const previewImg = document.getElementById('previewImg');

profilePictureInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        previewImg.src = e.target.result;
        imagePreview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  });

function clearForm() {
      // Clear input fields after successful signup
      document.getElementById('displayName').value = '';
      document.getElementById('email').value = '';
      document.getElementById('password').value = '';
      document.getElementById('confirmPassword').value = '';
      profilePictureInput.value = '';
      previewImg.src = '';
      imagePreview.classList.add('hidden');
}

  // Handle form submission
document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (password !== confirmPassword) {
      alert('Passwords do not match!');
      return;
    }

    const passwordStrengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordStrengthRegex.test(password)) {
        //clearForm();
        alert('Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.');
        return;
    }

    const formData = new FormData();

    
    formData.append('username', document.getElementById('email').value);
    formData.append('displayName', document.getElementById('displayName').value);
    formData.append('email', document.getElementById('email').value);
    formData.append('password', password);
    formData.append('profilePicture', profilePictureInput.files[0]);
    

    try {
      const res = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        body: formData,
      });

      if (res.status >= 400 && res.status < 600) {
        alert('An error occurred during signup. Please try again.');
        return;
      }
      const data = await res.json();
      console.log("Data: ", data);
    } catch (err) {
      console.error('Error uploading image:', err);
    }
    // Here you would typically send the form data to your backend
    console.log('Form submitted:', formData);

    //clearForm();
        
    // For now, just show a success message
    alert('Account created successfully!');
    window.location.href = '../signin/index.html';
    
      });

// Drag and drop functionality
const dropZone = document.querySelector('.border-dashed');
  
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, highlight, false);
  });

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, unhighlight, false);
  });

function highlight(e) {
    dropZone.classList.add('border-blue-400');
  }

function unhighlight(e) {
    dropZone.classList.remove('border-blue-400');
  }

dropZone.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    profilePictureInput.files = files;
    
    if (files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = function(e) {
        previewImg.src = e.target.result;
        imagePreview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  }
