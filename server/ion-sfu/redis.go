package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pion/webrtc/v3"
	"github.com/redis/go-redis/v9"
)

func splitRedisAddrs(addrs string) []string {
	var result []string
	for _, addr := range strings.Split(addrs, ",") {
		result = append(result, strings.TrimSpace(addr))
	}
	return result
}

func initRedis() {
	// Get SFU_ID from environment variable set in docker-compose
	sfuID = os.Getenv("SFU_ID")
	if sfuID == "" {
		sfuID = SFUIDPrefix + uuid.New().String()[:8] // Fallback if not set
	}
	log.Printf("SFU starting with ID: %s", sfuID)

	// Get signaling server URL
	signalingURL = os.Getenv("SIGNALING_SERVER_URL")
	if signalingURL == "" {
		signalingURL = "ws://localhost:8080" // Default fallback
	}

	// Setup Redis Cluster
	redisClusterNodesEnv := os.Getenv("REDIS_CLUSTER_NODES")
	if redisClusterNodesEnv == "" {
		log.Fatal("REDIS_CLUSTER_NODES environment variable not set.")
	}
	redisAddrs := splitRedisAddrs(redisClusterNodesEnv)

	// PRODUCTION: Redis Cluster Implementation (DEBUG VERSION)
	// TODO: Fix the "got 4 elements in cluster info address, expected 2 or 3" parsing issue
	redisClient = redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: redisAddrs,
		// Production cluster configuration
		PoolSize:     10,
		MinIdleConns: 5,
		MaxRetries:   3,
		// Cluster-specific options
		RouteByLatency: false,
		RouteRandomly:  false,
		// Add other options like password, TLS if needed
	})

	// Production: Robust Redis Cluster connection with retries
	maxRetries := 5
	for attempt := 1; attempt <= maxRetries; attempt++ {
		_, err := redisClient.Ping(ctx).Result()
		if err == nil {
			log.Printf("SFU: Connected to Redis Cluster on attempt %d", attempt)
			break
		}

		if attempt == maxRetries {
			log.Fatalf("SFU: Could not connect to Redis Cluster after %d attempts: %v", maxRetries, err)
		}

		log.Printf("SFU: Redis Cluster connection attempt %d failed: %v, retrying in 2 seconds...", attempt, err)
		time.Sleep(2 * time.Second)
	}
}

// listenToRedisCommands subscribes to SFU-specific commands from the Orchestration Service
func listenToRedisCommands() {
	ctx := context.Background()
	pubsub := redisClient.Subscribe(ctx, fmt.Sprintf("sfu_commands:%s", sfuID))
	defer pubsub.Close()

	log.Printf("SFU: Subscribed to Redis channel %s", fmt.Sprintf("sfu_commands:%s", sfuID))

	for msg := range pubsub.Channel() {
		log.Printf("SFU: Received Redis command on channel %s: %s", msg.Channel, msg.Payload)

		var sfuCommand SFUCommand
		err := json.Unmarshal([]byte(msg.Payload), &sfuCommand)
		if err != nil {
			log.Printf("SFU: Error unmarshalling Redis command: %v", err)
			continue
		}

		meetingID, ok := sfuCommand.Payload["meetingId"].(string)
		if !ok {
			log.Printf("SFU: Missing or invalid meetingId in Redis message")
			continue
		}

		meetingsMu.Lock()
		meeting, exists := meetings[meetingID]
		if !exists {
			meeting = &Meeting{
				ID:          meetingID,
				clients:     make(map[string]*ClientPeer),
				trackLocals: make(map[string]*webrtc.TrackLocalStaticRTP),
			}
			meetings[meetingID] = meeting
			log.Printf("SFU: Created new meeting instance for %s on SFU %s", meetingID, sfuID)
		}
		meetingsMu.Unlock()

		switch sfuCommand.Event {
		case "prepareMeeting":
			log.Printf("SFU: Preparing meeting %s", meetingID)
			// No specific action needed here beyond creating the meeting object
		case "clientJoined":
			clientID, ok := sfuCommand.Payload["clientId"].(string)
			if !ok {
				log.Printf("SFU: Missing or invalid clientId in clientJoined command")
				continue
			}
			log.Printf("SFU: Client %s joined meeting %s. Setting up PeerConnection.", clientID, meetingID)
			go setupClientPeerConnection(meeting, clientID)
			metricsMu.Lock()
			log.Printf("\t listenToRedisCommands has locked the metricsMu")
			sfuMetrics.ConnectedClients++
			if len(meeting.clients) == 0 { // First client in this meeting on this SFU
				sfuMetrics.ActiveMeetings++
			}
			metricsMu.Unlock()
			log.Printf("\t listenToRedisCommands has unlocked the metricsMu")
		case "clientLeft":
			clientID, ok := sfuCommand.Payload["clientId"].(string)
			if !ok {
				log.Printf("SFU: Missing or invalid clientId in clientLeft command")
				continue
			}
			log.Printf("SFU: Client %s left meeting %s. Cleaning up PeerConnection.", clientID, meetingID)
			meeting.mu.Lock()
			if peer, ok := meeting.clients[clientID]; ok {
				peer.PeerConnection.Close()
				delete(meeting.clients, clientID)
				metricsMu.Lock()
				log.Printf("\t listenToRedisCommands has locked the metricsMu")
				sfuMetrics.ConnectedClients--
				if len(meeting.clients) == 0 { // Last client in this meeting on this SFU
					sfuMetrics.ActiveMeetings--
				}
				metricsMu.Unlock()
				log.Printf("\t listenToRedisCommands has unlocked the metricsMu")
			}
			meeting.mu.Unlock()
			// If no clients left in this meeting on this SFU, clean up tracks
			if len(meeting.clients) == 0 {
				meeting.mu.Lock()
				meeting.trackLocals = make(map[string]*webrtc.TrackLocalStaticRTP) // Clear all tracks
				meeting.mu.Unlock()
				log.Printf("SFU: All clients left meeting %s. Cleared all tracks.", meetingID)
			}

		case "webrtcSignal":
			signalType := sfuCommand.Payload["type"].(string)
			senderID := sfuCommand.Payload["senderId"].(string)

			meeting.mu.RLock()
			peer, ok := meeting.clients[senderID]
			meeting.mu.RUnlock()

			if !ok {
				log.Printf("SFU: PeerConnection for client %s not found in meeting %s.", senderID, meetingID)
				return
			}

			peer.mu.Lock() // Lock the specific peer connection
			defer peer.mu.Unlock()

			switch signalType {
			case "offer":
				sdpStr := sfuCommand.Payload["sdp"].(string)
				offer := webrtc.SessionDescription{
					Type: webrtc.SDPTypeOffer,
					SDP:  sdpStr,
				}
				log.Printf("SFU: Received offer from client %s for meeting %s", senderID, meetingID)

				if err := peer.PeerConnection.SetRemoteDescription(offer); err != nil {
					log.Printf("SFU Error setting remote description for %s: %v", senderID, err)
					return
				}

				answer, err := peer.PeerConnection.CreateAnswer(nil)
				if err != nil {
					log.Printf("SFU Error creating answer for %s: %v", senderID, err)
					return
				}

				if err := peer.PeerConnection.SetLocalDescription(answer); err != nil {
					log.Printf("SFU Error setting local description for %s: %v", senderID, err)
					return
				}

				// Send answer back to client via Redis Pub/Sub to the Signaling Server
				sendSFUSignalToClient(senderID, "answer", answer.SDP, nil, meetingID)
				log.Printf("SFU: Sent answer to client %s for meeting %s", senderID, meetingID)

			case "candidate":
				candidateMap := sfuCommand.Payload["candidate"].(map[string]interface{})
				candidateJSON, _ := json.Marshal(candidateMap)
				var iceCandidate webrtc.ICECandidate
				if err := json.Unmarshal(candidateJSON, &iceCandidate); err != nil {
					log.Printf("SFU Error unmarshalling ICE candidate for %s: %v", senderID, err)
					return
				}
				log.Printf("SFU: Received ICE candidate from client %s for meeting %s", senderID, meetingID)

				if err := peer.PeerConnection.AddICECandidate(iceCandidate.ToJSON()); err != nil {
					log.Printf("SFU Error adding ICE candidate for %s: %v", senderID, err)
					return
				}
			}
		default:
			log.Printf("SFU: Unhandled SFU command type: %s", sfuCommand.Event)
		}
	}
}

// sendSFUSignalToClient sends signals from SFU to a specific client via Redis Pub/Sub
// The Signaling Server will be subscribed to this channel and forward to the client's WebSocket
func sendSFUSignalToClient(clientID string, signalType string, sdp string, candidate *webrtc.ICECandidate, meetingID string) {

	// Construct the message to be published to Redis
	msgPayload := SFUSignalToClientPayload{
		TargetClientID: clientID,
		SignalType:     signalType,
		SDP:            sdp,
		Candidate:      candidate,
		MeetingID:      meetingID,
	}
	// Wrap it in a generic WSMessage for consistency with signaling server's message handling
	wsMsg := WSMessage{
		Type:     "sfuSignalToClient", // This type tells the signaling server what to do
		Payload:  msgPayload,
		SenderID: sfuID,
	}

	msgJSON, err := json.Marshal(wsMsg)
	if err != nil {
		log.Printf("SFU: Error marshalling SFU signal to client: %v", err)
		return
	}

	// Publish to the channel that the signaling server listens to
	// The signaling server listens to 'sfu_commands' channel for all SFU communications
	err = redisClient.Publish(ctx, "sfu_commands", string(msgJSON)).Err()
	if err != nil {
		log.Printf("SFU: Error publishing SFU signal to client %s via Redis: %v", clientID, err)
	} else {
		log.Printf("SFU: Successfully sent %s signal to client %s via Redis", signalType, clientID)
	}
}

func sendHeartbeats() {
	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()
	ctx := context.Background()
	log.Printf("\t SendingHeartbeats(Function Call): Sending heartbeats to Redis Cluster")

	for range ticker.C {
		metricsMu.Lock()
		log.Printf("\t SendingHeartbeats has locked the metricsMu")
		sfuMetrics.LastHeartbeat = time.Now().UnixMilli()
		log.Printf("\t SendingHeartbeats(Function Call): Here is the last heartbeat: %v", sfuMetrics.LastHeartbeat)
		currentMetrics := sfuMetrics // Copy for sending
		metricsMu.Unlock()
		log.Printf("\t SendingHeartbeats has unlocked the metricsMu")
		log.Printf("\t SendingHeartbeats(Function Call): Here are the current metrics: %v", currentMetrics)
		// Update metrics in Redis Cluster
		err := redisClient.HMSet(ctx, fmt.Sprintf("sfu:%s:metrics", sfuID),
			"connected_clients", currentMetrics.ConnectedClients,
			"active_meetings", currentMetrics.ActiveMeetings,
			"last_heartbeat", currentMetrics.LastHeartbeat,
		).Err()
		if err != nil {
			log.Printf("SFU Error sending heartbeat to Redis Cluster: %v", err)
		}

		// Also publish to a pub/sub channel for other services to consume (e.g., Orchestration)
		heartbeatMsg := WSMessage{
			Type: "sfuHeartbeat",
			Payload: map[string]interface{}{
				"sfuId":   sfuID,
				"metrics": currentMetrics,
			},
		}
		heartbeatJSON, _ := json.Marshal(heartbeatMsg)
		err = redisClient.Publish(ctx, "sfu_heartbeats", string(heartbeatJSON)).Err()
		if err != nil {
			log.Printf("SFU Error publishing heartbeat to Redis Cluster Pub/Sub: %v", err)
		}
		// log.Printf("SFU %s sent heartbeat. Clients: %d, Meetings: %d", sfuID, currentMetrics.ConnectedClients, currentMetrics.ActiveMeetings)
	}
}
