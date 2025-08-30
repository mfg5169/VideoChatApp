const redis = require('../../utils/datamanagement/redis');
const sfuRedis = redis.sfu;
const { safeKafkaSend } = require('./communication');
const WebSocket = require('ws');
const { identifyMessageSource } = require('./message-identification');

// Production-level logging utility
const Logger = {
  levels: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  },
  currentLevel: 1, // INFO level by default
  
  formatMessage(level, component, message, data = null) {
    const timestamp = new Date().toISOString();
    const logLevel = Object.keys(this.levels)[level];
    
    // Get function call information
    const stack = new Error().stack;
    const caller = this.getCallerInfo(stack);
    
    const prefix = `[${timestamp}] [${logLevel}] [${component}] [${caller}]`;
    
    if (data) {
      return [`${prefix} ${message}`, data];
    }
    return [`${prefix} ${message}`];
  },
  
  getCallerInfo(stack) {
    try {
      // Split stack into lines and find the caller (skip the first 3 lines: Error, formatMessage, and the logging method)
      const lines = stack.split('\n');
      if (lines.length >= 4) {
        const callerLine = lines[3];
        // Extract function name and file info
        const match = callerLine.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
          const functionName = match[1];
          const filePath = match[2];
          const lineNumber = match[3];
          
          // Extract just the filename from the full path
          const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
          
          return `${functionName}@${fileName}:${lineNumber}`;
        }
      }
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  },
  
  debug(component, message, data = null) {
    if (this.currentLevel <= this.levels.DEBUG) {
      console.debug(...this.formatMessage(this.levels.DEBUG, component, message, data));
    }
  },
  
  info(component, message, data = null) {
    if (this.currentLevel <= this.levels.INFO) {
      console.info(...this.formatMessage(this.levels.INFO, component, message, data));
    }
  },
  
  warn(component, message, data = null) {
    if (this.currentLevel <= this.levels.WARN) {
      console.warn(...this.formatMessage(this.levels.WARN, component, message, data));
    }
  },
  
  error(component, message, error = null, data = null) {
    if (this.currentLevel <= this.levels.ERROR) {
      console.error(...this.formatMessage(this.levels.ERROR, component, message, data));
      if (error) {
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
      }
    }
  }
};

// Helper function to send WebSocket message with state check
function sendWebSocketMessage(ws, message, context) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
            Logger.info('WEBSOCKET', 'Message sent successfully', {
                messageType: message.type,
                context: context
            });
            return true;
        } catch (error) {
            Logger.error('WEBSOCKET', 'Failed to send message', error, {
                messageType: message.type,
                context: context
            });
            return false;
        }
    } else {
        Logger.warn('WEBSOCKET', 'Cannot send message - WebSocket not open', {
            messageType: message.type,
            context: context,
            wsExists: !!ws,
            wsReadyState: ws ? ws.readyState : 'null'
        });
        return false;
    }
}

// Helper state tracking
const HelperState = {
  totalRegistrations: 0,
  totalMeetingJoins: 0,
  totalMeetingLeaves: 0,
  totalChatMessages: 0,
  totalWebRTCMessages: 0,
  totalBroadcasts: 0,
  totalDisconnections: 0,
  totalErrors: 0,
  
  updateStats(type, value = 1) {
    switch(type) {
      case 'registration':
        this.totalRegistrations += value;
        break;
      case 'meetingJoin':
        this.totalMeetingJoins += value;
        break;
      case 'meetingLeave':
        this.totalMeetingLeaves += value;
        break;
      case 'chatMessage':
        this.totalChatMessages += value;
        break;
      case 'webrtcMessage':
        this.totalWebRTCMessages += value;
        break;
      case 'broadcast':
        this.totalBroadcasts += value;
        break;
      case 'disconnection':
        this.totalDisconnections += value;
        break;
      case 'error':
        this.totalErrors += value;
        break;
    }
  },
  
  getStats() {
    return {
      totalRegistrations: this.totalRegistrations,
      totalMeetingJoins: this.totalMeetingJoins,
      totalMeetingLeaves: this.totalMeetingLeaves,
      totalChatMessages: this.totalChatMessages,
      totalWebRTCMessages: this.totalWebRTCMessages,
      totalBroadcasts: this.totalBroadcasts,
      totalDisconnections: this.totalDisconnections,
      totalErrors: this.totalErrors
    };
  }
};

async function AddSignalingServerToRedis() {
  Logger.info('REDIS', 'Adding signaling server to Redis');
  
  try {
    const signalingServerUrl = process.env.EXTERNAL_WS_URL || null;
    Logger.debug('REDIS', 'Signaling server URL', { signalingServerUrl });
    
    await redis.sadd('available_signaling_servers', signalingServerUrl);
    Logger.info('REDIS', 'Signaling server added to Redis successfully', { signalingServerUrl });
  } catch (error) {
    Logger.error('REDIS', 'Failed to add signaling server to Redis', error);
    throw error;
  }
}

async function RegisterClientSfu(payload, ws, clients, sfus) {
    const { id, role } = payload;
    const timestamp = new Date().toISOString();
    const clientIP = ws._socket?.remoteAddress || 'Unknown';
    
    HelperState.updateStats('registration');
    
    Logger.info('REGISTER', 'Processing registration request', {
      id,
      role,
      clientIP,
      timestamp,
      clientsMapSize: clients.size,
      sfusMapSize: sfus.size
    });
    
    try {
        if (role === 'client') {
            clients.set(id, ws);
            ws.clientId = id; // Store ID on the WebSocket object
            ws.connectedAt = timestamp; // Store connection time
            ws.clientIP = clientIP; // Store client IP
            
            Logger.info('REGISTER', 'Client registered successfully', {
              id,
              clientIP,
              connectedAt: timestamp,
              clientsMapSize: clients.size,
              allClientIds: Array.from(clients.keys())
            });
        } else if (role === 'sfu') {
            sfus.set(id, ws);
            ws.sfuId = id; // Store ID on the WebSocket object
            Logger.info('REGISTER', 'SFU registered successfully', { id });

            await sfuRedis.hset(`sfu:${id}:metrics`, 'status', 'online', 'last_heartbeat', Date.now());
            await sfuRedis.sadd('available_sfus', id);
            
            Logger.debug('REGISTER', 'SFU metrics updated in Redis', { id });
        } else {
            Logger.warn('REGISTER', 'Unknown role specified', { id, role });
        }

        Logger.info('REGISTER', 'Registration completed', {
          id,
          role,
          clientsMapSize: clients.size,
          sfusMapSize: sfus.size
        });
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('REGISTER', 'Registration failed', error, { id, role, clientIP });
        throw error;
    }
}

async function ClientJoinsMeeting(ws, payload, senderId, clients) {
    const {meetingId} = payload;
    
    HelperState.updateStats('meetingJoin');
    
    Logger.info('MEETING', 'Client joining meeting', {
      senderId,
      meetingId,
      clientIP: ws.clientIP
    });
    
    try {
        ws.meetingId = meetingId; // Store meeting ID on the WebSocket object
        await redis.sadd(`meeting:${meetingId}:participants`, senderId);
        await redis.hset(`user:${senderId}:presence`, 'status', 'in_call', 'current_meeting_id', meetingId);
        
        Logger.info('MEETING', 'Client joined meeting successfully', {
          senderId,
          meetingId
        });

        // Notify SFU that client has joined (SFU ID is already assigned by Orchestration)
        const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');
        
        Logger.debug('MEETING', 'SFU assignment check', {
          meetingId,
          assignedSfuId
        });
        
        if (assignedSfuId) {
            Logger.info('MEETING', 'Notifying SFU of client join', {
              senderId,
              meetingId,
              assignedSfuId
            });
            
            await safeKafkaSend('sfu_commands', [
                { key: assignedSfuId, value: JSON.stringify({ type: 'clientJoined', payload: { clientId: String(senderId), meetingId: String(meetingId) } }) }
            ]);

            sendWebSocketMessage(ws, { 
                type: 'meetingJoined', 
                payload: { 
                    meetingId: meetingId,
                    success: true 
                } 
            }, `meetingJoined-${senderId}-${meetingId}`);
            
            // Broadcast to other clients in the meeting
            await broadcastToMeeting(meetingId, senderId, {
                type: 'meetingEvent',
                payload: {
                    type: 'clientJoined',
                    payload: { clientId: String(senderId), meetingId: String(meetingId) }
                }
            }, clients);
            
            Logger.info('MEETING', 'Client join notifications sent', {
              senderId,
              meetingId,
              assignedSfuId
            });
        } else {
            Logger.warn('MEETING', 'No SFU assigned for meeting', {
              meetingId,
              senderId
            });
            sendWebSocketMessage(ws, { 
                type: 'error', 
                message: 'Meeting SFU not assigned yet. Please try rejoining.' 
            }, `error-no-sfu-${senderId}-${meetingId}`);
        }
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('MEETING', 'Client join meeting failed', error, {
          senderId,
          meetingId
        });
        throw error;
    }
}

async function ClientLeavesMeeting( payload, senderId, clients) {
    const {meetingId} = payload;
    
    HelperState.updateStats('meetingLeave');
    
    Logger.info('MEETING', 'Client leaving meeting', {
      senderId,
      meetingId
    });
    
    try {
        await redis.srem(`meeting:${meetingId}:participants`, senderId);
        await redis.hset(`user:${senderId}:presence`, 'status', 'offline', 'current_meeting_id', null);
        
        Logger.info('MEETING', 'Client left meeting successfully', {
          senderId,
          meetingId
        });
        
        // Notify SFU that client left
        const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');
        
        Logger.debug('MEETING', 'SFU assignment check for leave', {
          meetingId,
          assignedSfuId
        });
        
        if (assignedSfuId) {
            Logger.info('MEETING', 'Notifying SFU of client leave', {
              senderId,
              meetingId,
              assignedSfuId
            });
            
            await safeKafkaSend('sfu_commands', [
                { key: assignedSfuId, value: JSON.stringify({ type: 'clientLeft', payload: { clientId: String(senderId), meetingId: String(meetingId) } }) }
            ]);
        }
        
        // Broadcast to other clients in the meeting
        await broadcastToMeeting(meetingId, senderId, {
            type: 'meetingEvent',
            payload: {
                type: 'clientLeft',
                payload: { clientId: String(senderId), meetingId: String(meetingId) }
            }
        }, clients);

        // If no participants left, clean up meeting state
        const participantsCount = await redis.scard(`meeting:${meetingId}:participants`);
        
        Logger.debug('MEETING', 'Meeting participants count after leave', {
          meetingId,
          participantsCount
        });
        
        if (participantsCount === 0) {
            Logger.info('MEETING', 'Cleaning up empty meeting', { meetingId });
            
            await redis.del(`meeting:${meetingId}:participants`);
            await redis.del(`meeting:${meetingId}:metadata`);
            await redis.del(`meeting:${meetingId}:active_speaker`);
            
            Logger.info('MEETING', 'Meeting cleanup completed', { meetingId });
        }
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('MEETING', 'Client leave meeting failed', error, {
          senderId,
          meetingId
        });
        throw error;
    }
}

async function handleChatMessage(payload, senderId, clients) {
    const { meetingId } = payload;
    
    HelperState.updateStats('chatMessage');
    
    Logger.info('CHAT', 'Processing chat message', {
      senderId,
      meetingId,
      messageLength: payload.message?.length
    });
    
    try {
        if (!meetingId) {
            Logger.warn('CHAT', 'Chat message received without meetingId', { senderId });
            return;
        }
        
        // Verify sender is in the meeting
        const isInMeeting = await redis.sismember(`meeting:${meetingId}:participants`, senderId);
        
        Logger.debug('CHAT', 'Meeting membership verification', {
          senderId,
          meetingId,
          isInMeeting
        });
        
        if (!isInMeeting) {
            Logger.warn('CHAT', 'Client not in meeting, ignoring chat message', {
              senderId,
              meetingId
            });
            return;
        }
        
        // Broadcast chat message to all participants in the meeting
        await broadcastToMeeting(meetingId, senderId, {
            type: 'chat',
            payload: payload
        }, clients);
        
        Logger.info('CHAT', 'Chat message broadcasted successfully', {
          senderId,
          meetingId
        });
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('CHAT', 'Chat message handling failed', error, {
          senderId,
          meetingId
        });
        throw error;
    }
}

async function broadcastToMeeting(meetingId, excludeSenderId, message, clients) {
    HelperState.updateStats('broadcast');
    
    Logger.info('BROADCAST', 'Broadcasting message to meeting', {
      meetingId,
      excludeSenderId,
      messageType: message.type,
      clientsCount: clients.size
    });
    
    try {
        // Get all participants in the meeting
        const participants = await redis.smembers(`meeting:${meetingId}:participants`);
        
        Logger.debug('BROADCAST', 'Meeting participants retrieved', {
          meetingId,
          participantsCount: participants.length,
          participants
        });
        
        let sentCount = 0;
        let failedCount = 0;
        
        // Send message to all participants except the sender
        for (const participantId of participants) {
            if (participantId !== excludeSenderId) {
                const clientWs = clients.get(participantId);
                if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                    try {
                        clientWs.send(JSON.stringify(message));
                        sentCount++;
                        Logger.debug('BROADCAST', 'Message sent to participant', {
                          participantId,
                          messageType: message.type
                        });
                    } catch (sendError) {
                        failedCount++;
                        Logger.error('BROADCAST', 'Failed to send message to participant', sendError, {
                          participantId,
                          messageType: message.type
                        });
                    }
                } else {
                    failedCount++;
                    Logger.warn('BROADCAST', 'Client not found or not connected', {
                      participantId,
                      meetingId,
                      wsExists: !!clientWs,
                      wsReadyState: clientWs ? clientWs.readyState : 'null'
                    });
                }
            }
        }
        
        Logger.info('BROADCAST', 'Broadcast completed', {
          meetingId,
          totalParticipants: participants.length,
          sentCount,
          failedCount,
          excludedSender: excludeSenderId
        });
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('BROADCAST', 'Error broadcasting to meeting', error, {
          meetingId,
          excludeSenderId
        });
        throw error;
    }
}

async function WebRTCHandler(payload, senderId, type, meetingId) {
    HelperState.updateStats('webrtcMessage');
    
    // Enhanced source identification
    const sourceInfo = identifyMessageSource(senderId);
    
    Logger.info('WEBRTC', 'Processing WebRTC signal', {
      type,
      senderId,
      sourceInfo: sourceInfo,
      meetingId,
      hasSdp: !!payload.sdp,
      hasCandidate: !!payload.candidate
    });
    
    try {
        const assignedSfuId = await redis.hget(`meeting:${meetingId}:metadata`, 'sfu_id');

        Logger.info('WEBRTC', 'SFU assignment check', {
          meetingId,
          assignedSfuId,
          hasAssignedSfu: !!assignedSfuId
        });

        if (assignedSfuId) {
            Logger.info('WEBRTC', 'Relaying WebRTC signal to SFU', {
              type,
              senderId,
              meetingId,
              assignedSfuId
            });
            
            // Relay message to the assigned SFU via Kafka
            const kafkaMessage = {
                key: assignedSfuId, 
                value: JSON.stringify({
                     type: 'webrtcSignal', 
                     payload: { type: type,
                                sdp: payload.sdp, 
                                candidate: payload.candidate, 
                                senderId: String(senderId), 
                                meetingId: String(meetingId) } 
                })
            };
            
            Logger.info('WEBRTC', 'Sending Kafka message to SFU', {
                kafkaKey: kafkaMessage.key,
                kafkaValue: kafkaMessage.value,
                assignedSfuId
            });
            
            await safeKafkaSend('sfu_commands', [kafkaMessage]);
            
            Logger.info('WEBRTC', 'WebRTC signal relayed successfully', {
              type,
              senderId,
              meetingId,
              assignedSfuId
            });
        } else {
            Logger.warn('WEBRTC', 'No SFU assigned for meeting', {
              meetingId,
              type,
              senderId
            });
        }
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('WEBRTC', 'WebRTC signal handling failed', error, {
          type,
          senderId,
          meetingId
        });
        throw error;
    }
}

function SfuSignalToClient(payload, clients) {
    const { targetClientId, signalType, sdp, candidate, meetingId: sfuMeetingId } = payload;
    
    // Enhanced target identification
    const targetInfo = identifyMessageSource(targetClientId);
    
    Logger.info('SFU', 'Processing SFU signal to client', {
      sourceType: 'sfu',
      targetInfo: targetInfo,
      signalType,
      meetingId: sfuMeetingId,
      hasSdp: !!sdp,
      hasCandidate: !!candidate
    });
    
    try {
        const targetWs = clients.get(targetClientId);
        
        Logger.debug('SFU', 'Target client lookup', {
          targetClientId,
          wsExists: !!targetWs,
          wsReadyState: targetWs ? targetWs.readyState : 'null'
        });
        
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            let messagePayload;
            
            if (signalType === 'answer') {
                // For answers, send the SDP directly as expected by RTCSessionDescription
                messagePayload = {
                    type: signalType,
                    payload: {
                        type: 'answer',
                        sdp: sdp
                    }
                };
            } else if (signalType === 'offer') {
                // For offers, send the SDP directly
                messagePayload = {
                    type: signalType,
                    payload: {
                        type: 'offer',
                        sdp: sdp
                    }
                };
            } else if (signalType === 'candidate') {
                // For candidates, send the candidate object with required fields
                Logger.info('SFU', 'Processing candidate signal', {
                    candidate: candidate,
                    candidateType: typeof candidate,
                    candidateKeys: candidate ? Object.keys(candidate) : 'null'
                });
                
                messagePayload = {
                    type: signalType,
                    payload: {
                        candidate: candidate.candidate,
                        sdpMid: candidate.sdpMid || '0',
                        sdpMLineIndex: candidate.sdpMLineIndex || 0
                    }
                };
            } else {
                // For other signal types, use the original format
                messagePayload = {
                    type: signalType,
                    payload: {
                        sdp: sdp,
                        candidate: candidate,
                        senderId: 'sfu',
                        meetingId: sfuMeetingId
                    }
                };
            }
            
            sendWebSocketMessage(targetWs, messagePayload, `sfu-signal-${targetClientId}-${signalType}`);
        } else {
            Logger.warn('SFU', 'Target client not found or not open', {
              targetClientId,
              wsExists: !!targetWs,
              wsReadyState: targetWs ? targetWs.readyState : 'null'
            });
        }
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('SFU', 'SFU signal to client failed', error, {
          targetClientId,
          signalType,
          meetingId: sfuMeetingId
        });
        throw error;
    }
}

async function WebSocketDisconnectClient(ws, clients){
    const timestamp = new Date().toISOString();
    const clientIP = ws.clientIP || 'Unknown';
    const connectedAt = ws.connectedAt || 'Unknown';
    
    HelperState.updateStats('disconnection');
    
    Logger.info('DISCONNECT', 'Client disconnecting', {
      clientId: ws.clientId,
      timestamp,
      clientIP,
      connectedAt,
      clientsMapSize: clients.size
    });
    
    try {
        // Clean up client state in Redis
        const currentMeetingId = await redis.hget(`user:${ws.clientId}:presence`, 'current_meeting_id');
        
        Logger.debug('DISCONNECT', 'Current meeting lookup', {
          clientId: ws.clientId,
          currentMeetingId
        });
        
        if (currentMeetingId) {
            Logger.info('DISCONNECT', 'Cleaning up client from meeting', {
              clientId: ws.clientId,
              meetingId: currentMeetingId
            });
            
            await redis.srem(`meeting:${currentMeetingId}:participants`, ws.clientId);
            
            // Notify SFU about client leaving
            const assignedSfuId = await redis.hget(`meeting:${currentMeetingId}:metadata`, 'sfu_id');
            
            if (assignedSfuId) {
                Logger.info('DISCONNECT', 'Notifying SFU of client disconnect', {
                  clientId: ws.clientId,
                  meetingId: currentMeetingId,
                  assignedSfuId
                });

                await safeKafkaSend('sfu_commands', [
                    { key: assignedSfuId, value: JSON.stringify({ type: 'clientLeft', payload: { clientId: String(ws.clientId), meetingId: String(currentMeetingId) } }) }
                ]);
            }
            
            // Broadcast to other clients in the meeting
            await broadcastToMeeting(currentMeetingId, ws.clientId, {
                type: 'meetingEvent',
                payload: {
                    type: 'clientLeft',
                    payload: { clientId: String(ws.clientId), meetingId: String(currentMeetingId) }
                }
            }, clients);
            
            // If no participants left, clean up meeting state
            const participantsCount = await redis.scard(`meeting:${currentMeetingId}:participants`);
            
            Logger.debug('DISCONNECT', 'Meeting participants count after disconnect', {
              meetingId: currentMeetingId,
              participantsCount
            });
            
            if (participantsCount === 0) {
                Logger.info('DISCONNECT', 'Cleaning up empty meeting due to last client leaving', {
                  meetingId: currentMeetingId
                });
                
                await redis.del(`meeting:${currentMeetingId}:participants`);
                await redis.del(`meeting:${currentMeetingId}:metadata`);
                await redis.del(`meeting:${currentMeetingId}:active_speaker`);
            }
        }
        
        await redis.hset(`user:${ws.clientId}:presence`, 'status', 'offline');
        clients.delete(ws.clientId);
        
        Logger.info('DISCONNECT', 'Client disconnect cleanup completed', {
          clientId: ws.clientId,
          clientsMapSize: clients.size
        });
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('DISCONNECT', 'Error during client disconnect cleanup', error, {
          clientId: ws.clientId,
          clientIP,
          connectedAt
        });
        throw error;
    }
}

async function WebSocketDisconnectSfu(ws, sfus){
    Logger.info('DISCONNECT', 'SFU disconnecting', {
      sfuId: ws.sfuId,
      sfusMapSize: sfus.size
    });
    
    try {
        await redis.srem('available_sfus', ws.sfuId);
        await redis.del(`sfu:${ws.sfuId}:metrics`);
        sfus.delete(ws.sfuId);
        
        Logger.info('DISCONNECT', 'SFU disconnect cleanup completed', {
          sfuId: ws.sfuId,
          sfusMapSize: sfus.size
        });
        
        // In a real app, you'd need to re-assign meetings from this SFU
        Logger.warn('DISCONNECT', 'SFU disconnected, meetings need re-assignment', {
          sfuId: ws.sfuId
        });
    } catch (error) {
        HelperState.updateStats('error');
        Logger.error('DISCONNECT', 'Error during SFU disconnect cleanup', error, {
          sfuId: ws.sfuId
        });
        throw error;
    }
}

// Add this to your signal-server.js
function startHeartbeat(clients) {
  Logger.info('HEARTBEAT', 'Starting heartbeat system');
  
  const heartbeatInterval = setInterval(async () => {
      try {
          const signalingServerId = process.env.SIGNALING_SERVER_ID || 'sig-alpha';
          const signalingServerUrl = process.env.EXTERNAL_WS_URL || null;
          const connectedClients = clients.size; // Number of connected clients
          
          Logger.debug('HEARTBEAT', 'Processing heartbeat', {
            signalingServerId,
            signalingServerUrl,
            connectedClients,
            clientIds: Array.from(clients.keys())
          });
          
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
          
          Logger.debug('HEARTBEAT', 'Heartbeat sent successfully', {
            signalingServerId,
            connectedClients
          });
      } catch (error) {
        HelperState.updateStats('error');
        Logger.error('HEARTBEAT', 'Error sending heartbeat', error);
      }
  }, 5000); // Every 5 seconds
  
  Logger.info('HEARTBEAT', 'Heartbeat system started', {
    intervalMs: 5000
  });
  
  // Store the interval ID so you can clear it on shutdown
  return heartbeatInterval;
}

module.exports = { 
  AddSignalingServerToRedis, 
  RegisterClientSfu, 
  ClientJoinsMeeting, 
  ClientLeavesMeeting, 
  WebRTCHandler, 
  SfuSignalToClient, 
  WebSocketDisconnectClient, 
  WebSocketDisconnectSfu, 
  startHeartbeat, 
  handleChatMessage, 
  broadcastToMeeting,
  Logger,
  HelperState
};