// orchestration-service/server.js
const express = require('express');
const Redis = require('ioredis');

const app = express();
app.use(express.json()); // For parsing JSON request bodies

// Configure Redis Cluster client
const redisClusterNodesEnv = process.env.REDIS_CLUSTER_NODES || 'localhost:6379';
const redisClusterNodes = redisClusterNodesEnv.split(',').map(node => {
  const [host, port] = node.split(':');
  return { host, port: parseInt(port, 10) };
});

const redis = new Redis.Cluster(redisClusterNodes);

console.log('Orchestration Service: Connecting to Redis Cluster...');
redis.on('connect', () => {
  console.log('Orchestration Service: Connected to Redis Cluster!');
});
redis.on('error', (err) => {
  console.error('Orchestration Service: Redis Cluster error:', err);
});

// Get list of Signaling Server URLs from environment variable
const signalingServerURLsEnv = process.env.SIGNALING_SERVER_URLS || 'ws://localhost:8080';
const signalingServerURLs = signalingServerURLsEnv.split(',').map(url => url.trim());
console.log('Configured Signaling Server URLs:', signalingServerURLs);

// Simple round-robin index for Signaling Server selection
let nextSignalingServerIndex = 0;

// API Endpoint for client to join a meeting
app.post('/api/meeting/join', async (req, res) => {
  const { clientId, meetingId } = req.body;

  if (!clientId || !meetingId) {
    return res.status(400).json({ error: 'clientId and meetingId are required.' });
  }

  try {
    // --- 1. Check if meeting already has an assigned SFU and Signaling Server ---
    let assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');
    let assignedSignalingServerUrl = await redis.hget(`meeting:${meetingId}:metadata`, 'signaling_server_url');

    if (!assignedSfuId || !assignedSignalingServerUrl) {
      console.log(`Meeting ${meetingId} needs new SFU/Signaling Server assignment.`);

      // --- 2. Select an optimal SFU instance (Load Balancing Logic) ---
      const availableSfuIds = await redis.smembers('available_sfus');
      if (availableSfuIds.length === 0) {
        console.error('No SFU available for assignment!');
        return res.status(503).json({ error: 'No SFU available. Please try again later.' });
      }

      let bestSfuId = null;
      let minConnectedClients = Infinity;
      const healthySfuCandidates = [];

      for (const sfuCandidateId of availableSfuIds) {
        const metrics = await redis.hgetall(`sfu:${sfuCandidateId}:metrics`);
        const connectedClients = parseInt(metrics.connected_clients || '0', 10);
        const lastHeartbeat = parseInt(metrics.last_heartbeat || '0', 10);

        // Basic health check: heartbeat within last 15 seconds
        if (Date.now() - lastHeartbeat < 15000) { // SFU heartbeats every 5s, allow some buffer
          healthySfuCandidates.push({ id: sfuCandidateId, connectedClients: connectedClients });
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

      if (!bestSfuId) {
        console.error('No healthy SFU available for assignment after filtering!');
        return res.status(503).json({ error: 'No healthy SFU available. Please try again later.' });
      }
      assignedSfuId = bestSfuId;

      // --- 3. Select an optimal Signaling Server instance (Load Balancing / Round Robin) ---
      const healthySignalingServerURLs = [];
      let bestSignalingServerUrl = null;
      let minSignalingClients = Infinity;

      for (const url of signalingServerURLs) {
        // Extract ID from URL (e.g., ws://localhost:8080 -> sig-alpha)
        // This assumes a convention where the signaling server ID is known or derivable from its config
        // For simplicity, we'll assume the Signaling Server ID is the last part of the URL path or hostname if unique
        // A more robust approach would be for Signaling Servers to register their ID and URL in Redis.
        const urlObj = new URL(url);
        const sigServerId = urlObj.hostname + ':' + urlObj.port; // e.g., localhost:8080

        const metrics = await redis.hgetall(`signaling:${sigServerId}:metrics`);
        const connectedClients = parseInt(metrics.connected_clients || '0', 10);
        const lastHeartbeat = parseInt(metrics.last_heartbeat || '0', 10);

        if (Date.now() - lastHeartbeat < 15000) { // Signaling server heartbeats every 5s
          healthySignalingServerURLs.push({ url: url, connectedClients: connectedClients });
          if (connectedClients < minSignalingClients) {
            minSignalingClients = connectedClients;
            bestSignalingServerUrl = url;
          }
        } else {
          console.warn(`Signaling Server ${sigServerId} is stale. Removing from consideration.`);
          // Don't remove from signalingServerURLs array, as it's static config
          // But it won't be chosen if unhealthy.
        }
      }

      if (!bestSignalingServerUrl) {
         console.warn('No healthy Signaling Server available, falling back to round-robin from configured list if any.');
         // Fallback to simple round-robin if no healthy ones based on metrics
         if (signalingServerURLs.length > 0) {
            bestSignalingServerUrl = signalingServerURLs[nextSignalingServerIndex % signalingServerURLs.length];
            nextSignalingServerIndex++;
         } else {
            console.error('No Signaling Servers configured at all!');
            return res.status(503).json({ error: 'No Signaling Servers available.' });
         }
      }
      assignedSignalingServerUrl = bestSignalingServerUrl;

      // --- 4. Store assignment in Redis ---
      await redis.hset(`meeting:${meetingId}:metadata`,
        'sfu_id', assignedSfuId,
        'signaling_server_url', assignedSignalingServerUrl
      );
      console.log(`Meeting ${meetingId} assigned to SFU ${assignedSfuId} and Signaling Server ${assignedSignalingServerUrl}.`);

      // --- 5. Instruct SFU to prepare for meeting (via Redis Pub/Sub) ---
      redis.publish(`sfu_commands:${assignedSfuId}`, JSON.stringify({
        type: 'prepareMeeting',
        payload: { meetingId: meetingId }
      }));

    } else {
      console.log(`Meeting ${meetingId} already assigned to SFU ${assignedSfuId} and Signaling Server ${assignedSignalingServerUrl}.`);
    }

    // --- 6. Respond to client ---
    res.json({
      meetingId: meetingId,
      signalingServerUrl: assignedSignalingServerUrl,
      sfuId: assignedSfuId // Optional, for client debugging/info
    });

  } catch (error) {
    console.error('Orchestration Service Error:', error);
    res.status(500).json({ error: 'Internal server error during meeting join.' });
  }
});

const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
  console.log(`Orchestration Service listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Orchestration Service: Shutting down...');
  redis.quit();
  console.log('Orchestration Service: Gracefully shut down.');
  process.exit(0);
});
