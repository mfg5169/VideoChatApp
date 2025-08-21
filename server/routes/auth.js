const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsSync = require('fs');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

// e.g., '7e9e1c64-8c9e-4e74-a8b5-dc2895b3b3c1'

// Import your utilities
const { decryptSecret } = require('../utils/auth/encrytion.js');
const supabase = require('../utils/datamanagement/supabase.js');

dotenv.config({ path: path.join(__dirname, '../.env') });

// JWT secret
const passphrase = process.env.JWT_PASSPHRASE;
const JWT_SECRET = decryptSecret(passphrase);


// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/'); // Save to uploads folder
    },
    filename: (req, file, cb) => {
      const id = uuidv4();
      const uniqueName = Date.now() + '-' + id + path.extname(file.originalname);

      cb(null, uniqueName); // Unique name
    },
  });

const upload = multer({ storage });


// Username/Password Signup
router.post('/signup', upload.single('profilePicture'), async (req, res) => {
    try {

        const uploadedFile = req.file; // multer adds `file` to `req`
        const uniqueFilename = uploadedFile ? uploadedFile.filename : null;

        const { username, email, password, displayName} = req.body;
        // Validate input

        console.log("req.body: ", req.body);

        // console.log("username: ", username);
        // console.log("email: ", email);
        // console.log("password: ", password);
        // console.log("displayName: ", displayName);
        // console.log("uniqueFilename: ", uniqueFilename);

        
        if (!username || !email || !password || !displayName) {
            return res.status(400).json({ 
                error: 'all fields are required' 
            });
        }

        // console.log("username: ", username);
        // console.log("email: ", email);
        // console.log("password: ", password);
        // console.log("displayName: ", displayName);
        // console.log("uniqueFilename: ", uniqueFilename);




        // Check if user already exists
        const { data: existingUser, error: checkError } = await supabase
            .from('users')
            .select('id, email')
            .or(`email.eq.${email},username.eq.${username}`)
            .single();


        if (existingUser) {
            return res.status(409).json({ 
                error: 'User with this email or username already exists' 
            });
        }


        console.log("User Already Exists?: ", checkError.message);
        console.log("--------------------------------\n\n");

        // Check password strength
        // At minimum: 8+ chars, at least 1 uppercase, 1 lowercase, 1 number, 1 special char
        const passwordStrengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
        if (!passwordStrengthRegex.test(password)) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.'
            });
        }
        // Hash password
        const saltRounds = parseInt(process.env.SALT_ROUNDS) || 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const verificationToken = uuidv4();


        console.info("Creating user in database");
        // Create user in database
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([
                {
                    username,
                    email,
                    password_hash: hashedPassword,
                    display_name: displayName,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    avatar_url: uniqueFilename,
                    
                    is_verified: false,
                    verify_token: verificationToken
                }
            ])
            .select('id, username, email, created_at')
            .single();

        console.info("User created in database");

        if (insertError) {
            console.log("Database Insert Error: ", insertError.message);
            console.log("--------------------------------\n\n");
    // Get the current user
           const { data: user, error } = await supabase.auth.getUser();

            if (error) {
            console.log('Error fetching user:', error.message);
            } else if (user) {
            console.log('Authenticated user:', user);
            } else {
            console.log('No user authenticated (anon or guest)');
            }

            console.log("User details: ", user);
            return res.status(500).json({ error: 'Failed to create user' });
        }


        // const transporter = nodemailer.createTransport({
        //     service: 'Gmail',
        //     auth: {
        //       user: process.env.EMAIL_USER,
        //       pass: process.env.EMAIL_PASS,
        //     },
        //   });
          
        //   const protocol = req.protocol;
        //   const host = req.get('host');
        //   const baseUrl = `${protocol}://${host}`;
        //   const verificationUrl = `${baseUrl}/verify?token=${verificationToken}`;
          


        //   const templatePath = path.join(__dirname, 'emailTemplate.html');
        //   let html = fsSync.readFileSync(templatePath, 'utf8');

        //   html = html.replace('{{VERIFICATION_URL}}', verificationUrl);

        //   await transporter.sendMail({
        //     to: email,
        //     subject: 'Verify your email',
        //     html
        //   });
          
        //   await transporter.sendMail({
        //     to: email,
        //     subject: 'Verify your email',
        //     html: `
        //       <div style="font-family: Arial, sans-serif; font-size: 16px; color: #333;">
        //         <p>Hello,</p>
        //         <p>Click the button below to verify your email address:</p>
        //         <a href="${verificationUrl}" 
        //            style="
        //              display: inline-block;
        //              padding: 10px 20px;
        //              margin-top: 10px;
        //              background-color: #4CAF50;
        //              color: white;
        //              text-decoration: none;
        //              border-radius: 4px;
        //              font-weight: bold;
        //            ">
        //            Verify Email
        //         </a>
        //         <p>If the button doesn't work, copy and paste the link below into your browser:</p>
        //         <p style="word-break: break-all;">${verificationUrl}</p>
        //       </div>
        //     `
        //   });
          
          
        // Generate JWT token

        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Manage session (create or update)
        // try {
        //     await manageUserSession(
        //         newUser.id,
        //         req.headers['user-agent'],
        //         req.ip,
        //         token
        //     );
        // } catch (sessionError) {
        //     console.error('Session management error during signup:', sessionError);
        //     return res.status(500).json({ error: 'Failed to manage session' });
        // }

        console.info("Signup successful");
        res.status(201).json({
            message: 'Signup successful'
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Username/Password Login
router.post('/login', async (req, res) => {
    try {

        const { email, password } = req.body;


        // Validate input
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email and password are required' 
            });
        }

        // Find user by email
        const { data: user, error: findError } = await supabase
            .from('users')
            .select('id, username, email, password_hash, avatar_url')
            .eq('email', email)
            .single();

        if (findError || !user) {
            console.log("Invalid user");
            console.log("--------------------------------\n\n");
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if user uses OAuth
        // if (user.auth_provider !== 'email') {
        //     return res.status(401).json({ 
        //         error: 'Please use OAuth to login with this account' 
        //     });
        // }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            console.log("Invalid credentials");
            console.log("--------------------------------\n\n");
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT token
        const accessToken = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const refreshToken = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // console.log("accessToken: ", accessToken);
        // console.log("refreshToken: ", refreshToken);
        // console.log("user: ", user);
        // console.log("--------------------------------\n\n");



        // Manage session (create or update)
        try {
            await manageUserSession(
                user.id,
                req.headers['user-agent'],
                req.ip,
                refreshToken
            );
        } catch (sessionError) {
            console.error('Session management error during login:', sessionError);
            return res.status(500).json({ error: 'Failed to manage session' });
        }

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict', // Prevent CSRF attacks
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        return res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar_url: user.avatar_url
            },
            accessToken
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/refresh-token', async (req, res) => {
    try {
        const refreshToken = req.cookies && req.cookies.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }

        // Verify the refresh token
        let decodedToken;
        try {
            decodedToken = jwt.verify(refreshToken, JWT_SECRET);
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ error: 'Refresh token has expired' });
            }
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Check if the refresh token exists in the database and is valid
        // Also join with users table to ensure user still exists and is active
        const { data: sessionWithUser, error: sessionError } = await supabase
            .from('sessions')
            .select(`
                id, 
                user_id, 
                refresh_token, 
                last_active,
                users!inner (
                    id,
                    username,
                    email,
                    avatar_url,
                    is_verified,
                    created_at
                )
            `)
            .eq('user_id', decodedToken.userId)
            .eq('refresh_token', refreshToken)
            .single();

        if (sessionError || !sessionWithUser) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Check if the session has expired (optional: you can set a session timeout)
        const sessionTimeout = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
        const lastActive = new Date(sessionWithUser.last_active);
        const now = new Date();
        
        if (now - lastActive > sessionTimeout) {
            // Session has expired, delete it from database
            await supabase
                .from('sessions')
                .delete()
                .eq('id', sessionWithUser.id);
            
            return res.status(401).json({ error: 'Session has expired' });
        }

        // Check if user is verified (optional security check)
        if (!sessionWithUser.users.is_verified) {
            return res.status(403).json({ error: 'Account not verified' });
        }

        const user = sessionWithUser.users;

        // Generate new access token
        const newAccessToken = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Generate new refresh token
        const newRefreshToken = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Update the session with new refresh token and last_active
        const { error: updateError } = await supabase
            .from('sessions')
            .update({
                refresh_token: newRefreshToken,
                last_active: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', sessionWithUser.id);

        if (updateError) {
            console.error('Session update error:', updateError);
            return res.status(500).json({ error: 'Failed to update session' });
        }

        // Set new refresh token in cookie
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        // Return new access token in Authorization header
        res.setHeader('Authorization', `Bearer ${newAccessToken}`);

        return res.json({
            message: 'Token refreshed successfully',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar_url: user.avatar_url
            },
            accessToken: newAccessToken
        });

    } catch (error) {
        console.error('Refresh token error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
    });
    res.json({ message: 'Logged out successfully' });
  });
// // OAuth Signup/Login (Google, GitHub, etc.)
// router.post('/oauth', async (req, res) => {
//     try {
//         const { provider, accessToken, userData } = req.body;

//         // Validate input
//         if (!provider || !accessToken || !userData) {
//             return res.status(400).json({ 
//                 error: 'Provider, access token, and user data are required' 
//             });
//         }

//         // Verify OAuth token with provider (you'll need to implement this)
//         const verifiedUserData = await verifyOAuthToken(provider, accessToken, userData);
        
//         if (!verifiedUserData) {
//             return res.status(401).json({ error: 'Invalid OAuth token' });
//         }

//         // Check if user already exists
//         const { data: existingUser, error: checkError } = await supabase
//             .from('users')
//             .select('id, username, email, auth_provider')
//             .eq('email', verifiedUserData.email)
//             .single();

//         if (existingUser) {
//             // User exists, check if they used the same OAuth provider
//             if (existingUser.auth_provider !== provider) {
//                 return res.status(409).json({ 
//                     error: `Account already exists with ${existingUser.auth_provider} authentication` 
//                 });
//             }

//             // Generate JWT token for existing user
//             const token = jwt.sign(
//                 { userId: existingUser.id, email: existingUser.email },
//                 JWT_SECRET,
//                 { expiresIn: '24h' }
//             );

//             return res.json({
//                 message: 'OAuth login successful',
//                 user: {
//                     id: existingUser.id,
//                     username: existingUser.username,
//                     email: existingUser.email
//                 },
//                 token
//             });
//         }

//         // Create new user with OAuth data
//         const { data: newUser, error: insertError } = await supabase
//             .from('users')
//             .insert([
//                 {
//                     username: verifiedUserData.username || verifiedUserData.name,
//                     email: verifiedUserData.email,
//                     auth_provider: provider,
//                     oauth_id: verifiedUserData.id,
//                     created_at: new Date().toISOString(),
//                     updated_at: new Date().toISOString(),
//                     is_verified: true
//                 }
//             ])
//             .select('id, username, email, created_at')
//             .single();

//         if (insertError) {
//             console.error('Database insert error:', insertError);
//             return res.status(500).json({ error: 'Failed to create user' });
//         }

//         // Generate JWT token
//         const token = jwt.sign(
//             { userId: newUser.id, email: newUser.email },
//             JWT_SECRET,
//             { expiresIn: '24h' }
//         );

//         res.status(201).json({
//             message: 'OAuth signup successful',
//             user: {
//                 id: newUser.id,
//                 username: newUser.username,
//                 email: newUser.email
//             },
//             token
//         });

//     } catch (error) {
//         console.error('OAuth error:', error);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// });

// // Helper function to verify OAuth tokens
// async function verifyOAuthToken(provider, accessToken, userData) {
//     try {
//         switch (provider) {
//             case 'google':
//                 // Verify Google token
//                 const response = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${accessToken}`);
//                 if (response.ok) {
//                     const googleUser = await response.json();
//                     return {
//                         id: googleUser.id,
//                         email: googleUser.email,
//                         username: googleUser.name,
//                         name: googleUser.name
//                     };
//                 }
//                 break;

//             case 'github':
//                 // Verify GitHub token
//                 const githubResponse = await fetch('https://api.github.com/user', {
//                     headers: {
//                         'Authorization': `token ${accessToken}`
//                     }
//                 });
//                 if (githubResponse.ok) {
//                     const githubUser = await githubResponse.json();
//                     return {
//                         id: githubUser.id.toString(),
//                         email: userData.email, // GitHub doesn't always provide email
//                         username: githubUser.login,
//                         name: githubUser.name
//                     };
//                 }
//                 break;

//             default:
//                 throw new Error(`Unsupported OAuth provider: ${provider}`);
//         }
        
//         return null;
//     } catch (error) {
//         console.error('OAuth verification error:', error);
//         return null;
//     }
// }

// // Verify JWT token middleware
// const authenticateToken = (req, res, next) => {
//     const authHeader = req.headers['authorization'];
//     const token = authHeader && authHeader.split(' ')[1];

//     if (!token) {
//         return res.status(401).json({ error: 'Access token required' });
//     }

//     jwt.verify(token, JWT_SECRET, (err, user) => {
//         if (err) {
//             return res.status(403).json({ error: 'Invalid or expired token' });
//         }
//         req.user = user;
//         next();
//     });
// };

// // Protected route example
// router.get('/profile', authenticateToken, async (req, res) => {
//     try {
//         const { data: user, error } = await supabase
//             .from('users')
//             .select('id, username, email, created_at')
//             .eq('id', req.user.userId)
//             .single();

//         if (error || !user) {
//             return res.status(404).json({ error: 'User not found' });
//         }

//         res.json({ user });
//     } catch (error) {
//         console.error('Profile error:', error);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// });

// Helper function to manage sessions
async function manageUserSession(userId, userAgent, ipAddress, refreshToken) {
    try {
        // Check if a session already exists for this user, device, and IP
        const { data: existingSession, error: findError } = await supabase
            .from('sessions')
            .select('id')
            .eq('user_id', userId)
            .eq('device_info', userAgent)
            .eq('ip_address', ipAddress)
            .single();

        if (existingSession) {
            // Update existing session
            const { data: updatedSession, error: updateError } = await supabase
                .from('sessions')
                .update({
                    last_active: new Date().toISOString(),
                    refresh_token: refreshToken
                })
                .eq('id', existingSession.id)
                .select('id')
                .single();

            if (updateError) {
                console.error('Session update error:', updateError);
                throw new Error('Failed to update session');
            }

            return updatedSession;
        } else {
            // Create new session
            const { data: newSession, error: insertError } = await supabase
                .from('sessions')
                .insert([
                    {
                        user_id: userId,
                        device_info: userAgent,
                        ip_address: ipAddress,
                        last_active: new Date().toISOString(),
                        refresh_token: refreshToken,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    }
                ])
                .select('id')
                .single();

            if (insertError) {
                console.error('Session insert error:', insertError);
                throw new Error('Failed to create session');
            }

            return newSession;
        }
    } catch (error) {
        console.error('Session management error:', error);
        throw error;
    }
}

module.exports = router;