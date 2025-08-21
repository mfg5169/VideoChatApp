const redis = require('../../utils/datamanagement/redis');
const sfuRedis = redis.sfu;
const { safeKafkaSend } = require('./communication');


async function AddSignalingServerToRedis() {
  const signalingServerUrl = process.env.EXTERNAL_WS_URL || null;
  await redis.sadd('available_signaling_servers', signalingServerUrl);
}

async function RegisterClientSfu(payload, ws, clients, sfus) {
    const { id, role } = payload;
    if (role === 'client') {
        clients.set(id, ws);
        ws.clientId = id; // Store ID on the WebSocket object
        console.info(`Client ${id} registered.`);
    } else if (role === 'sfu') {
        sfus.set(id, ws);
        ws.sfuId = id; // Store ID on the WebSocket object
        console.info(`SFU ${id} registered.`);

        await sfuRedis.hset(`sfu:${id}:metrics`, 'status', 'online', 'last_heartbeat', Date.now());
        await sfuRedis.sadd('available_sfus', id);
    }

    return;
}

async function ClientJoinsMeeting(ws, payload, senderId) {
    const {meetingId} = payload;
    ws.meetingId = meetingId; // Store meeting ID on the WebSocket object
    await redis.sadd(`meeting:${meetingId}:participants`, senderId);
    await redis.hset(`user:${senderId}:presence`, 'status', 'in_call', 'current_meeting_id', meetingId);
    console.info(`Client ${senderId} joined meeting ${meetingId}.`);

    // Notify SFU that client has joined (SFU ID is already assigned by Orchestration)
    const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');
    if (assignedSfuId) {
        await safeKafkaSend('sfu_commands', [
            { key: assignedSfuId, value: JSON.stringify({ event: 'clientJoined', payload: { clientId: senderId, meetingId: meetingId } }) }
        ]);
        
        // Broadcast to other clients in the meeting
        await broadcastToMeeting(meetingId, senderId, {
            type: 'meetingEvent',
            payload: {
                type: 'clientJoined',
                payload: { clientId: senderId, meetingId: meetingId }
            }
        }, clients);
    } else {
      console.warn(`Signaling Server: No SFU assigned for meeting ${meetingId} yet. Client ${senderId} joined this signaling server.`);
      ws.send(JSON.stringify({ type: 'error', message: 'Meeting SFU not assigned yet. Please try rejoining.' }));
    }
    return;
}

async function ClientLeavesMeeting( payload, senderId) {
    const {meetingId} = payload;
    await redis.srem(`meeting:${meetingId}:participants`, senderId);
    await redis.hset(`user:${senderId}:presence`, 'status', 'offline', 'current_meeting_id', null);
    console.info(`Client ${senderId} left meeting ${meetingId}.`);
    
    // Notify SFU that client left
    const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');
    if (assignedSfuId) {
        await safeKafkaSend('sfu_commands', [
            { key: assignedSfuId, value: JSON.stringify({ event: 'clientLeft', payload: { clientId: senderId, meetingId: meetingId } }) }
        ]);
    }
    
    // Broadcast to other clients in the meeting
    await broadcastToMeeting(meetingId, senderId, {
        type: 'meetingEvent',
        payload: {
            type: 'clientLeft',
            payload: { clientId: senderId, meetingId: meetingId }
        }
    }, clients);

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

async function handleChatMessage(payload, senderId, clients) {
    const { meetingId } = payload;
    
    if (!meetingId) {
        console.warn('Chat message received without meetingId');
        return;
    }
    
    // Verify sender is in the meeting
    const isInMeeting = await redis.sismember(`meeting:${meetingId}:participants`, senderId);
    if (!isInMeeting) {
        console.warn(`Client ${senderId} tried to send chat message but not in meeting ${meetingId}`);
        return;
    }
    
    // Broadcast chat message to all participants in the meeting
    await broadcastToMeeting(meetingId, senderId, {
        type: 'chat',
        payload: payload
    }, clients);
    
    console.log(`Chat message from ${senderId} broadcasted to meeting ${meetingId}`);
}

async function broadcastToMeeting(meetingId, excludeSenderId, message, clients) {
    try {
        // Get all participants in the meeting
        const participants = await redis.smembers(`meeting:${meetingId}:participants`);
        
        // Send message to all participants except the sender
        for (const participantId of participants) {
            if (participantId !== excludeSenderId) {
                const clientWs = clients.get(participantId);
                if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify(message));
                } else {
                    console.warn(`Client ${participantId} not found or not connected for meeting ${meetingId}`);
                }
            }
        }
    } catch (error) {
        console.error('Error broadcasting to meeting:', error);
    }
}

async function WebRTCHandler(payload, senderId, type, meetingId) {
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

          await safeKafkaSend('sfu_commands', [
              { key: assignedSfuId, value: JSON.stringify({
                   event: 'webrtcSignal', 
                   payload: { type: type,
                              sdp: payload.sdp, 
                              candidate: payload.candidate, 
                              senderId: senderId, 
                              meetingId: meetingId } }) }
          ]);
        } else {
          console.warn(`No SFU assigned for meeting ${meetingId}. Cannot relay ${type}.`);
        }

        return;
}

function SfuSignalToClient(payload, clients) {
    const { targetClientId, signalType, sdp, candidate, meetingId: sfuMeetingId } = payload;
    const targetWs = clients.get(targetClientId);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({ 
            type: signalType, 
            payload: { 
                sdp: sdp, 
                candidate: candidate, 
                senderId: 'sfu', 
                meetingId: sfuMeetingId } }));
    } else {
        console.warn(`Target client ${targetClientId} not found or not open. Cannot relay SFU signal.`);
    }
    return;
}

async function WebSocketDisconnectClient(ws, clients){
    console.log(`Client ${ws.clientId} disconnected.`);
    // Clean up client state in Redis
    const currentMeetingId = await redis.hget(`user:${ws.clientId}:presence`, 'current_meeting_id');
    if (currentMeetingId) {
      await redis.srem(`meeting:${currentMeetingId}:participants`, ws.clientId);
      // Notify SFU about client leaving
      const assignedSfuId = await redis.hget(`meeting:${currentMeetingId}:metadata`, 'sfu_id');
      if (assignedSfuId) {

        await safeKafkaSend('sfu_commands', [
            { key: assignedSfuId, value: JSON.stringify({ event: 'clientLeft', payload: { clientId: ws.clientId, meetingId: currentMeetingId } }) }
        ]);
      }
      
      // Broadcast to other clients in the meeting
      await broadcastToMeeting(currentMeetingId, ws.clientId, {
          type: 'meetingEvent',
          payload: {
              type: 'clientLeft',
              payload: { clientId: ws.clientId, meetingId: currentMeetingId }
          }
      }, clients);
      
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
    return;
}

async function WebSocketDisconnectSfu(ws, sfus){
      console.log(`SFU ${ws.sfuId} disconnected.`);
      await redis.srem('available_sfus', ws.sfuId);
      await redis.del(`sfu:${ws.sfuId}:metrics`);
      sfus.delete(ws.sfuId);
      // In a real app, you'd need to re-assign meetings from this SFU
      console.warn(`SFU ${ws.sfuId} disconnected. Meetings assigned to it need re-assignment.`);
    
      return;
}

// Add this to your signal-server.js
function startHeartbeat(clients) {
  const heartbeatInterval = setInterval(async () => {
      try {
          const signalingServerId = process.env.SIGNALING_SERVER_ID || 'sig-alpha';
          const signalingServerUrl = process.env.EXTERNAL_WS_URL || null;
          const connectedClients = clients.size; // Number of connected clients
          
          console.log(`Signaling server ${signalingServerUrl} has tracked a heartbeat at ${Date.now()}`);
          // Update metrics in Redis
          await redis.hset(`signaling:${signalingServerUrl}:metrics`, 
              'connected_clients', connectedClients,
              'last_heartbeat', Date.now(),
              'status', 'online'
          );
          
          // Publish heartbeat to Redis Pub/Sub
          await redis.publish('signaling_heartbeats', JSON.stringify({
              type: 'signalingHeartbeat',
              payload: {
                  signalingServerId,
                  connectedClients,
                  timestamp: Date.now()
              }
          }));
          
          console.log(`Signaling server ${signalingServerId} sent heartbeat. Clients: ${connectedClients}`);
      } catch (error) {
          console.error('Error sending heartbeat:', error);
      }
  }, 5000); // Every 5 seconds
  
  // Store the interval ID so you can clear it on shutdown
  return heartbeatInterval;
}



module.exports = { AddSignalingServerToRedis, RegisterClientSfu, ClientJoinsMeeting, ClientLeavesMeeting, WebRTCHandler, SfuSignalToClient, WebSocketDisconnectClient, WebSocketDisconnectSfu, startHeartbeat, handleChatMessage, broadcastToMeeting };