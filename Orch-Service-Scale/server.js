// signaling-server/server.js
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const Redis = require('ioredis');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Get Signaling Server ID from environment variable
const signalingServerId = process.env.SIGNALING_SERVER_ID || 'sig-default';
console.log(`Signaling Server starting with ID: ${signalingServerId}`);

// Configure Redis Cluster client
const redisClusterNodesEnv = process.env.REDIS_CLUSTER_NODES || 'localhost:6379';
const redisClusterNodes = redisClusterNodesEnv.split(',').map(node => {
  const [host, port] = node.split(':');
  return { host, port: parseInt(port, 10) };
});

const redis = new Redis.Cluster(redisClusterNodes);

console.log('Signaling Server: Connecting to Redis Cluster...');
redis.on('connect', () => {
  console.log('Signaling Server: Connected to Redis Cluster!');
  // Register this signaling server's presence and initial metrics
  updateSignalingServerMetrics();
});
redis.on('error', (err) => {
  console.error('Signaling Server: Redis Cluster error:', err);
});

// Store WebSocket connections (clients and SFUs)
const clients = new Map(); // Map<clientId, WebSocket>
const sfus = new Map();    // Map<sfuId, WebSocket> (SFUs don't connect directly to signaling anymore in this model, but keep for consistency if they did)

// Redis Pub/Sub subscriber for inter-service communication
const subscriber = new Redis.Cluster(redisClusterNodes);

// Subscribe to channels for SFU commands and meeting events
subscriber.subscribe('sfu_commands:*', 'meeting_events:*', (err, count) => {
  if (err) {
    console.error("Signaling Server: Failed to subscribe:", err.message);
  } else {
    console.log(`Signaling Server: Subscribed to ${count} channels.`);
  }
});

subscriber.on('message', (channel, message) => {
  console.log(`Signaling Server: Redis Pub/Sub message on channel ${channel}: ${message}`);
  try {
    const data = JSON.parse(message);
    const { type, payload } = data;

    // Handle messages for SFU instances (commands from Orchestration/Signaling)
    // This is primarily for the Orchestration Service to send commands *to* SFUs.
    // Signaling server just relays client signals to SFU.
    if (channel.startsWith('sfu_commands:')) {
      const sfuId = channel.split(':')[1];
      // SFUs are not directly connected to Signaling Server in this architecture
      // This block would be for SFU-specific commands, not client-SFU signaling
      // For now, we'll assume SFUs directly listen to their command channel.
      console.log(`Signaling Server: Received SFU command for ${sfuId}. (Not directly handled here, SFU listens to Redis)`);
    }
    // Handle messages for clients (e.g., meeting events from SFU)
    else if (channel.startsWith('meeting_events:')) {
      const meetingId = channel.split(':')[1];
      // Get all clients in this meeting from Redis
      redis.smembers(`meeting:${meetingId}:participants`)
        .then(participantIds => {
          participantIds.forEach(clientId => {
            const clientWs = clients.get(clientId);
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'meetingEvent', payload: data }));
            }
          });
        })
        .catch(err => console.error('Signaling Server: Error getting meeting participants from Redis:', err));
    }

  } catch (e) {
    console.error('Signaling Server: Error parsing Redis Pub/Sub message:', e, message.toString());
  }
});

// Periodically update this signaling server's metrics in Redis
let connectedClientCount = 0;
function updateSignalingServerMetrics() {
  const externalWsUrl = process.env.EXTERNAL_WS_URL || `ws://localhost:${server.address().port}`; // Get external URL
  redis.hset(`signaling:${externalWsUrl.replace('ws://', '').replace('wss://', '')}:metrics`,
    'connected_clients', connectedClientCount,
    'last_heartbeat', Date.now(),
    'url', externalWsUrl
  ).catch(err => console.error('Signaling Server: Error updating metrics in Redis:', err));
  // Also add to a set of available signaling servers (Orchestration Service will use this)
  redis.sadd('available_signaling_servers', externalWsUrl).catch(err => console.error('Signaling Server: Error adding to available set:', err));
}
setInterval(updateSignalingServerMetrics, 5000); // Update every 5 seconds

wss.on('connection', (ws) => {
  console.log('Signaling Server: New WebSocket connection established.');
  connectedClientCount++;
  updateSignalingServerMetrics(); // Update metrics immediately

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { type, payload, senderId, targetId, meetingId } = data;

      console.log(`Signaling Server: Received message from ${senderId || 'unknown'}: ${type}`);

      // --- Handle initial client registration ---
      if (type === 'register') {
        const { id, role } = payload;
        if (role === 'client') {
          clients.set(id, ws);
          ws.clientId = id; // Store ID on the WebSocket object
          console.log(`Signaling Server: Client ${id} registered.`);
        }
        // SFUs no longer register directly with signaling servers in this model
        return;
      }

      // Ensure senderId is present for subsequent messages
      if (!senderId) {
        console.warn('Signaling Server: Message received without senderId:', data);
        return;
      }

      // --- Handle meeting join/leave (from client) ---
      if (type === 'joinMeeting') {
        const { meetingId } = payload;
        ws.meetingId = meetingId; // Store meeting ID on client's WebSocket
        await redis.sadd(`meeting:${meetingId}:participants`, senderId);
        await redis.hset(`user:${senderId}:presence`, 'status', 'in_call', 'current_meeting_id', meetingId, 'signaling_server_id', signalingServerId);
        console.log(`Signaling Server: Client ${senderId} joined meeting ${meetingId}.`);

        // Notify SFU that client has joined (SFU ID is already assigned by Orchestration)
        const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');
        if (assignedSfuId) {
          redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
            type: 'clientJoined',
            payload: { clientId: senderId, meetingId: meetingId }
          }));
        } else {
          console.warn(`Signaling Server: No SFU assigned for meeting ${meetingId} yet. Client ${senderId} joined this signaling server.`);
          ws.send(JSON.stringify({ type: 'error', message: 'Meeting SFU not assigned yet. Please try rejoining.' }));
        }
        return;
      }

      if (type === 'leaveMeeting') {
        const { meetingId } = payload;
        await redis.srem(`meeting:${meetingId}:participants`, senderId);
        await redis.hset(`user:${senderId}:presence`, 'status', 'offline');
        console.log(`Signaling Server: Client ${senderId} left meeting ${meetingId}.`);

        // Notify SFU that client left
        const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');
        if (assignedSfuId) {
          redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
            type: 'clientLeft',
            payload: { clientId: senderId, meetingId: meetingId }
          }));
        }

        // If no participants left, clean up meeting state
        const participantsCount = await redis.scard(`meeting:${meetingId}:participants`);
        if (participantsCount === 0) {
          await redis.del(`meeting:${meetingId}:participants`);
          await redis.del(`meeting:${meetingId}:metadata`);
          await redis.del(`meeting:${meetingId}:active_speaker`);
          console.log(`Signaling Server: Meeting ${meetingId} cleaned up.`);
        }
        return;
      }

      // --- Handle WebRTC signaling messages (relay to SFU) ---
      if (type === 'offer' || type === 'answer' || type === 'candidate') {
        const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');

        if (assignedSfuId) {
          // Relay message to the assigned SFU via Redis Pub/Sub
          redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
            type: 'webrtcSignal',
            payload: {
              type: type,
              sdp: payload.sdp,      // For offer/answer
              candidate: payload.candidate, // For candidate
              senderId: senderId,
              meetingId: meetingId
            }
          }));
        } else {
          console.warn(`Signaling Server: No SFU assigned for meeting ${meetingId}. Cannot relay ${type}.`);
          ws.send(JSON.stringify({ type: 'error', message: 'SFU not assigned for this meeting.' }));
        }
        return;
      }

      // --- Handle SFU's responses to clients (offers/answers/candidates from SFU to client) ---
      if (type === 'sfuSignalToClient') {
        const { targetClientId, signalType, sdp, candidate, meetingId: sfuMeetingId } = payload;
        const targetWs = clients.get(targetClientId);

        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: signalType, // 'offer', 'answer', 'candidate'
            payload: {
              sdp: sdp,
              candidate: candidate,
              senderId: 'sfu', // Indicate sender is SFU
              meetingId: sfuMeetingId
            }
          }));
        } else {
          console.warn(`Signaling Server: Target client ${targetClientId} not found or not open. Cannot relay SFU signal.`);
        }
        return;
      }

      // --- Handle SFU's meeting events (e.g., active speaker) ---
      if (type === 'sfuMeetingEvent') {
        const { meetingId: sfuMeetingId, eventType, eventData } = payload;
        // Publish this event to all clients in the meeting via Redis Pub/Sub
        redis.publish(`meeting_events:${sfuMeetingId}`, JSON.stringify({
          type: eventType,
          payload: eventData
        }));
        return;
      }

      console.log('Signaling Server: Unhandled message type:', type, data);

    } catch (e) {
      console.error('Signaling Server: Error processing WebSocket message:', e, message.toString());
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
    }
  });

  ws.on('close', async () => {
    connectedClientCount--;
    updateSignalingServerMetrics(); // Update metrics immediately
    if (ws.clientId) {
      console.log(`Signaling Server: Client ${ws.clientId} disconnected.`);
      // Clean up client state in Redis
      const currentMeetingId = await redis.hget(`user:${ws.clientId}:presence`, 'current_meeting_id');
      if (currentMeetingId) {
        await redis.srem(`meeting:${currentMeetingId}:participants`, ws.clientId);
        // Notify SFU about client leaving
        const assignedSfuId = await redis.hget(`meeting:${currentMeetingId}:metadata`, 'sfu_id');
        if (assignedSfuId) {
          redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
            type: 'clientLeft',
            payload: { clientId: ws.clientId, meetingId: currentMeetingId }
          }));
        }
        // If no participants left, clean up meeting state
        const participantsCount = await redis.scard(`meeting:${currentMeetingId}:participants`);
        if (participantsCount === 0) {
          await redis.del(`meeting:${currentMeetingId}:participants`);
          await redis.del(`meeting:${currentMeetingId}:metadata`);
          await redis.del(`meeting:${currentMeetingId}:active_speaker`);
          console.log(`Signaling Server: Meeting ${currentMeetingId} cleaned up due to last client leaving.`);
        }
      }
      await redis.hset(`user:${ws.clientId}:presence`, 'status', 'offline');
      clients.delete(ws.clientId);
    }
    // SFUs don't directly connect to signaling servers in this model, so no SFU cleanup here
  });

  ws.on('error', (error) => {
    console.error('Signaling Server: WebSocket error:', error);
  });
});

// Serve static files (like your frontend HTML/JS)
app.use(express.static('public')); // Assuming your frontend files are in a 'public' directory

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Signaling Server ${signalingServerId} listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`Signaling Server ${signalingServerId}: Shutting down...`);
  wss.close(() => {
    server.close(() => {
      redis.quit();
      subscriber.quit();
      console.log(`Signaling Server ${signalingServerId}: Gracefully shut down.`);
      process.exit(0);
    });
  });
});
