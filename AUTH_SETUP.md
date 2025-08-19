# Authentication Setup Guide

This guide explains how to set up both username/password and OAuth authentication for your VideoChat application.

## Database Setup

1. **Create the users table in Supabase:**
   - Run the SQL commands from `database-schema.sql` in your Supabase SQL editor
   - This creates a table that supports both email/password and OAuth users

## Environment Variables

Create a `.env` file in your project root with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# OAuth Configuration (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Server Configuration
PORT=3000
NODE_ENV=development
```

## Installation

Install the required dependencies:

```bash
npm install bcryptjs jsonwebtoken @supabase/supabase-js
```

## API Endpoints

### 1. Username/Password Signup
```http
POST /auth/signup
Content-Type: application/json

{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "message": "Signup successful",
  "user": {
    "id": "uuid",
    "username": "john_doe",
    "email": "john@example.com"
  },
  "token": "jwt-token"
}
```

### 2. Username/Password Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securepassword123"
}
```

### 3. OAuth Signup/Login
```http
POST /auth/oauth
Content-Type: application/json

{
  "provider": "google",
  "accessToken": "oauth-access-token",
  "userData": {
    "id": "google-user-id",
    "email": "john@gmail.com",
    "name": "John Doe"
  }
}
```

### 4. Get User Profile (Protected Route)
```http
GET /auth/profile
Authorization: Bearer jwt-token
```

## OAuth Provider Setup

### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add your domain to authorized origins
6. Add your callback URL to authorized redirect URIs

### GitHub OAuth
1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set the callback URL to your application's OAuth callback endpoint
4. Note the Client ID and Client Secret

## Frontend Integration

### Username/Password Signup
```javascript
const signup = async (username, email, password) => {
  const response = await fetch('/auth/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, email, password }),
  });
  
  const data = await response.json();
  if (response.ok) {
    // Store token in localStorage or secure storage
    localStorage.setItem('token', data.token);
    return data.user;
  } else {
    throw new Error(data.error);
  }
};
```

### OAuth Signup
```javascript
const oauthSignup = async (provider, accessToken, userData) => {
  const response = await fetch('/auth/oauth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ provider, accessToken, userData }),
  });
  
  const data = await response.json();
  if (response.ok) {
    localStorage.setItem('token', data.token);
    return data.user;
  } else {
    throw new Error(data.error);
  }
};
```

### Using Protected Routes
```javascript
const getProfile = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('/auth/profile', {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  const data = await response.json();
  if (response.ok) {
    return data.user;
  } else {
    throw new Error(data.error);
  }
};
```

## Security Considerations

1. **JWT Secret:** Use a strong, random secret for JWT_SECRET
2. **Password Hashing:** Passwords are automatically hashed using bcrypt
3. **HTTPS:** Always use HTTPS in production
4. **Token Storage:** Store tokens securely (consider httpOnly cookies for web apps)
5. **Rate Limiting:** Implement rate limiting on auth endpoints
6. **Input Validation:** All inputs are validated on the server side

## Error Handling

The API returns appropriate HTTP status codes:
- `200` - Success
- `201` - Created (signup)
- `400` - Bad Request (missing fields)
- `401` - Unauthorized (invalid credentials)
- `403` - Forbidden (invalid token)
- `409` - Conflict (user already exists)
- `500` - Internal Server Error

## Testing

You can test the endpoints using tools like Postman or curl:

```bash
# Test signup
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","email":"test@example.com","password":"password123"}'

# Test login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
``` 