// signaling-server/server.js
// This is the main server logic for the signaling service.

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const Redis = require('ioredis');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configure Redis Cluster client
// Get Redis cluster nodes from environment variable (set in docker-compose.yml)
const redisClusterNodesEnv = process.env.REDIS_CLUSTER_NODES || 'localhost:6379';
const redisClusterNodes = redisClusterNodesEnv.split(',').map(node => {
  const [host, port] = node.split(':');
  return { host, port: parseInt(port, 10) };
});

const redis = new Redis.Cluster(redisClusterNodes);

console.log('Connecting to Redis Cluster...');
redis.on('connect', () => {
  console.log('Connected to Redis Cluster!');
});
redis.on('error', (err) => {
  console.error('Redis Cluster error:', err);
});

// Store WebSocket connections (clients and SFUs)
const clients = new Map(); // Map<clientId, WebSocket>
const sfus = new Map();    // Map<sfuId, WebSocket>

// Redis Pub/Sub subscriber for inter-service communication
const subscriber = new Redis.Cluster(redisClusterNodes);

// Subscribe to channels for SFU commands and meeting events
subscriber.subscribe('sfu_commands:*', 'meeting_events:*', 'sfu_heartbeats', (err, count) => {
  if (err) {
    console.error("Failed to subscribe:", err.message);
  } else {
    console.log(`Subscribed to ${count} channels.`);
  }
});

subscriber.on('message', (channel, message) => {
  console.log(`Redis Pub/Sub message on channel ${channel}: ${message}`);
  try {
    const data = JSON.parse(message);
    const { type, payload } = data;

    // Handle messages for SFU instances (commands from Orchestration/Signaling)
    if (channel.startsWith('sfu_commands:')) {
      const sfuId = channel.split(':')[1];
      const sfuWs = sfus.get(sfuId);
      if (sfuWs && sfuWs.readyState === WebSocket.OPEN) {
        sfuWs.send(JSON.stringify({ type: 'sfuCommand', payload: data }));
      } else {
        console.warn(`SFU ${sfuId} not found or not open, cannot send command.`);
      }
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
        .catch(err => console.error('Error getting meeting participants from Redis:', err));
    }
    // Handle SFU heartbeats
    else if (channel === 'sfu_heartbeats') {
      const { sfuId, metrics } = payload;
      // Update SFU metrics in Redis (this is done by SFU itself, but we can log/monitor here)
      // For this example, we'll just log that we received it.
      // In a real system, the Orchestration Service would process these heartbeats.
      console.log(`Received heartbeat from SFU ${sfuId}:`, metrics);
    }

  } catch (e) {
    console.error('Error parsing Redis Pub/Sub message:', e, message);
  }
});

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established.');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { type, payload, senderId, targetId, meetingId } = data;

      console.log(`Received message from ${senderId || 'unknown'}: ${type}`);

      // --- Handle initial registration (client or SFU) ---
      if (type === 'register') {
        const { id, role } = payload;
        if (role === 'client') {
          clients.set(id, ws);
          ws.clientId = id; // Store ID on the WebSocket object
          console.log(`Client ${id} registered.`);
        } else if (role === 'sfu') {
          sfus.set(id, ws);
          ws.sfuId = id; // Store ID on the WebSocket object
          console.log(`SFU ${id} registered.`);
          // SFU registers, update its presence in Redis
          // The SFU itself will send heartbeats to update metrics.
          await redis.sadd('available_sfus', id); // Add to a set of available SFUs
        }
        return;
      }

      // Ensure senderId is present for subsequent messages
      if (!senderId) {
        console.warn('Message received without senderId:', data);
        return;
      }

      // --- Handle meeting join/leave (from client) ---
      if (type === 'joinMeeting') {
        const { meetingId } = payload;
        ws.meetingId = meetingId; // Store meeting ID on client's WebSocket
        await redis.sadd(`meeting:${meetingId}:participants`, senderId);
        await redis.hset(`user:${senderId}:presence`, 'status', 'in_call', 'current_meeting_id', meetingId);
        console.log(`Client ${senderId} joined meeting ${meetingId}.`);

        let assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');

        // SFU selection logic (simplified Orchestration Service)
        if (!assignedSfuId) {
          console.log(`Meeting ${meetingId} needs an SFU assignment.`);
          const availableSfuIds = await redis.smembers('available_sfus');
          if (availableSfuIds.length > 0) {
            let bestSfuId = null;
            let minConnectedClients = Infinity;

            for (const sfuCandidateId of availableSfuIds) {
              const metrics = await redis.hgetall(`sfu:${sfuCandidateId}:metrics`);
              const connectedClients = parseInt(metrics.connected_clients || '0', 10);
              const lastHeartbeat = parseInt(metrics.last_heartbeat || '0', 10);

              // Basic health check: heartbeat within last 30 seconds
              if (Date.now() - lastHeartbeat < 30000) {
                if (connectedClients < minConnectedClients) {
                  minConnectedClients = connectedClients;
                  bestSfuId = sfuCandidateId;
                }
              } else {
                console.warn(`SFU ${sfuCandidateId} is stale (no recent heartbeat). Removing from available_sfus.`);
                await redis.srem('available_sfus', sfuCandidateId);
                await redis.del(`sfu:${sfuCandidateId}:metrics`);
              }
            }

            if (bestSfuId) {
              assignedSfuId = bestSfuId;
              await redis.hset(`meeting:${meetingId}:metadata`, 'sfu_id', assignedSfuId);
              console.log(`Meeting ${meetingId} assigned to SFU ${assignedSfuId} (least load).`);

              // Send a command to the selected SFU to prepare for the meeting
              redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
                type: 'prepareMeeting',
                payload: { meetingId: meetingId }
              }));
            } else {
              console.error('No healthy SFU available to assign to meeting!');
              ws.send(JSON.stringify({ type: 'error', message: 'No healthy SFU available.' }));
              return;
            }
          } else {
            console.error('No SFU available to assign to meeting!');
            ws.send(JSON.stringify({ type: 'error', message: 'No SFU available.' }));
            return;
          }
        } else {
          console.log(`Meeting ${meetingId} already assigned to SFU ${assignedSfuId}.`);
        }

        // Send a message to the assigned SFU that a client has joined
        if (assignedSfuId) {
          redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
            type: 'clientJoined',
            payload: { clientId: senderId, meetingId: meetingId }
          }));
        }

        return;
      }

      if (type === 'leaveMeeting') {
        const { meetingId } = payload;
        await redis.srem(`meeting:${meetingId}:participants`, senderId);
        await redis.hset(`user:${senderId}:presence`, 'status', 'offline');
        console.log(`Client ${senderId} left meeting ${meetingId}.`);

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
          console.log(`Meeting ${meetingId} cleaned up.`);
        }
        return;
      }

      // --- Handle WebRTC signaling messages ---
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
          console.warn(`No SFU assigned for meeting ${meetingId}. Cannot relay ${type}.`);
        }
        return;
      }

      // --- Handle SFU's responses to clients (offers/answers/candidates) ---
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
          console.warn(`Target client ${targetClientId} not found or not open. Cannot relay SFU signal.`);
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

      console.log('Unhandled message type:', type, data);

    } catch (e) {
      console.error('Error processing WebSocket message:', e, message.toString());
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
    }
  });

  ws.on('close', async () => {
    if (ws.clientId) {
      console.log(`Client ${ws.clientId} disconnected.`);
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
          console.log(`Meeting ${currentMeetingId} cleaned up due to last client leaving.`);
        }
      }
      await redis.hset(`user:${ws.clientId}:presence`, 'status', 'offline');
      clients.delete(ws.clientId);
    } else if (ws.sfuId) {
      console.log(`SFU ${ws.sfuId} disconnected.`);
      await redis.srem('available_sfus', ws.sfuId);
      await redis.del(`sfu:${ws.sfuId}:metrics`);
      sfus.delete(ws.sfuId);
      // In a real app, you'd need to re-assign meetings from this SFU
      console.warn(`SFU ${ws.sfuId} disconnected. Meetings assigned to it need re-assignment.`);
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
  wss.close(() => {
    server.close(() => {
      redis.quit();
      subscriber.quit();
      console.log('Signaling server gracefully shut down.');
      process.exit(0);
    });
  });
});
