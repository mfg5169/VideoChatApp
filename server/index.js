const express = require('express');
const cors = require('cors');
const { fileURLToPath } = require('url');
const { dirname, join } = require('path');
const http = require('http');
const WebSocket = require('ws');
const redis = require('redis');
const fs = require('fs/promises');
const fsSync = require('fs');
const dotenv = require('dotenv');
const path = require('path');
const authRoutes = require('./routes/auth.js');
const meetingRoutes = require('./routes/meeting.js');

const { generateAndSaveJWTSecret, decryptSecret, authenticateToken } = require('./utils/auth/encrytion.js');

console.log("loading env.................");
dotenv.config();//{ path: path.join(__dirname, '../.env') });
// console.log(dotenv.config());

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);
console.log(__filename);
console.log(__dirname);



const filePath = path.join(__dirname, './config/env.encrytion.json');

if (!fsSync.existsSync(filePath)) {
  const passphrase = process.env.JWT_PASSPHRASE;
  console.log("file exists: ", fsSync.existsSync(filePath));
  console.log("filePath: ", filePath);

  try {
    generateAndSaveJWTSecret(passphrase); 
  } catch (error) {
    console.log("passphrase: ", passphrase);
    console.error("Error generating and saving JWT secret:", error);
  }
}

// const jwtSecret = decryptSecret(passphrase);
// console.log('JWT Secret ready for signing:', jwtSecret);

const app = express();
const port = process.env.BACKEND_PORT;

const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

const redisClient = require('./utils/datamanagement/redis.js');

wss.on('connection', socket => {
  socket.on('message', async message => {
    const data = JSON.parse(message);
    const room = data.room;

    // Broadcast to all users in same room
    wss.clients.forEach(client => {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });

    // Optionally use Redis pub/sub to broadcast across nodes
    await redisClient.publish(room, JSON.stringify(data));
  });
});



// Setting Express to trust proxies
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());

// Token authentication middleware
const jwt = require('jsonwebtoken');
const JWT_SECRET = decryptSecret(process.env.JWT_PASSPHRASE);



// Public routes
app.use('/auth', authRoutes);

// Protected routes (all future routes should be added after this middleware)
app.use(authenticateToken);

app.use('/meeting', meetingRoutes);


// app.listen(port, () => {
//     console.log(`Server is running on port ${port} (configured from ${process.env.BACKEND_PORT ? 'environment' : 'default'})`);
//   });

server.listen(port, '0.0.0.0', () => {
    console.log(`Index Setup:Server is running on port ${port} (configured from ${process.env.BACKEND_PORT ? 'environment' : 'default'})`);
  });





