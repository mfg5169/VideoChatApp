// This is the main server logic for the signaling service.

const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });


const redis = require('../utils/datamanagement/redis');

const { MeetingsConsumer, safeKafkaSend } = require('./utils/communication');
const { RegisterClientSfu, ClientJoinsMeeting, ClientLeavesMeeting, WebRTCHandler, SfuSignalToClient, WebSocketDisconnectClient, WebSocketDisconnectSfu, startHeartbeat } = require('./utils/signal-helpers');

// Store WebSocket connections (clients and SFUs)
const clients = new Map(); // Map<clientId, WebSocket>
const sfus = new Map();    // Map<sfuId, WebSocket>

// Start heartbeat interval
const heartbeatInterval = startHeartbeat(clients);


wss.on('connection', (ws) => {
  console.log('New WebSocket connection established.');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { type, payload, senderId, targetId, meetingId } = data;

      console.log(`Received message from ${senderId || 'unknown'}: ${type}`);

      // --- Handle initial registration (client or SFU) ---
      if (type === 'register') {
        RegisterClientSfu(payload, ws, clients, sfus);
        return;
      }

      // Ensure senderId is present for subsequent messages
      if (!senderId) {
        console.warn('Message received without senderId:', data);
        return;
      }

      // --- Handle meeting join/leave (from client) ---
      if (type === 'joinMeeting') {
        ClientJoinsMeeting(ws, payload, senderId);
        return;
  
      }      

      if (type === 'leaveMeeting') {
        ClientLeavesMeeting(payload, senderId);
        return;
      }

      // --- Handle WebRTC signaling messages ---
      if (type === 'offer' || type === 'answer' || type === 'candidate') {
        WebRTCHandler(payload, senderId, type, meetingId);
        return;
      }

      // --- Handle SFU's responses to clients (offers/answers/candidates) ---
      if (type === 'sfuSignalToClient') {
        SfuSignalToClient(payload, clients);
        return;
      }

      // --- Handle SFU's meeting events (e.g., active speaker) ---
      if (type === 'sfuMeetingEvent') {
        const { meetingId: sfuMeetingId, eventType, eventData } = payload;
        // Publish this event to all clients in the meeting via Redis Pub/Sub
        // redis.publish(`meeting_events:${sfuMeetingId}`, JSON.stringify({
        //   type: eventType,
        //   payload: eventData
        // }));

        await safeKafkaSend('meeting-events', [
            { key: sfuMeetingId, value: JSON.stringify({ type: eventType, payload: eventData }) }
        ]);
        return;
      }

      console.log('Unhandled message type:', type, data);

    } catch (e) {
      console.error('Error processing WebSocket message:', e, message.toString());
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
    }
  });

  ws.on('close', async () => {
    if (ws.clientId) {
      WebSocketDisconnectClient(ws, clients);
    } else if (ws.sfuId) {
      WebSocketDisconnectSfu(ws, sfus);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Serve static files (like your frontend HTML/JS)
app.use(express.static('public')); // Assuming your frontend files are in a 'public' directory

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down signaling server...');
  clearInterval(heartbeatInterval);
  wss.close(() => {
    server.close(() => {
      redis.quit();
      MeetingsConsumer.disconnect();
      console.log('Signaling server gracefully shut down.');
      process.exit(0);
    });
  });
});