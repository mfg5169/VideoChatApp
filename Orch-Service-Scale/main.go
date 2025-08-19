// sfu/main.go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings" // Import for strings.Split
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/websocket" // Still needed for client PeerConnections
	"github.com/pion/webrtc/v3"
	"github.com/google/uuid"
)

// SFU Configuration
const (
	SFUIDPrefix        = "sfu-"
	HeartbeatInterval  = 5 * time.Second // How often SFU sends metrics to Redis
)

// Message structures for WebSocket communication with Signaling Server (for client-SFU signals)
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
	SenderID string    `json:"senderId,omitempty"`
	TargetID string    `json:"targetId,omitempty"`
	MeetingID string   `json:"meetingId,omitempty"`
}

type RegisterPayload struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

type WebRTCSignalPayload struct {
	Type      string `json:"type"` // "offer", "answer", "candidate"
	SDP       string `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidate `json:"candidate,omitempty"`
	SenderID  string `json:"senderId"`
	MeetingID string `json:"meetingId"`
}

type SFUSignalToClientPayload struct {
	TargetClientID string             `json:"targetClientId"`
	SignalType     string             `json:"signalType"` // "offer", "answer", "candidate"
	SDP            string             `json:"sdp,omitempty"`
	Candidate      *webrtc.ICECandidate `json:"candidate,omitempty"`
	MeetingID      string             `json:"meetingId"`
}

type SFUMeetingEventPayload struct {
	MeetingID string      `json:"meetingId"`
	EventType string      `json:"eventType"`
	EventData interface{} `json:"eventData"`
}

// SFUMetrics represents the current load/status of this SFU instance
type SFUMetrics struct {
	ConnectedClients int64 `json:"connected_clients"`
	ActiveMeetings   int64 `json:"active_meetings"`
	LastHeartbeat    int64 `json:"last_heartbeat"` // Unix timestamp
	// Add more metrics like CPU, memory, bandwidth if needed
}

// Meeting represents a single conference room managed by this SFU instance
type Meeting struct {
	ID        string
	mu        sync.RWMutex
	clients   map[string]*ClientPeer // Map<clientId, *ClientPeer>
	trackLocals map[string]*webrtc.TrackLocalStaticRTP // Map<trackID, *TrackLocalStaticRTP>
}

// ClientPeer represents a WebRTC peer connection for a client connected to this SFU
type ClientPeer struct {
	ID           string
	MeetingID    string
	PeerConnection *webrtc.PeerConnection
	mu           sync.Mutex // Protects PeerConnection state
}

var (
	sfuID      string
	redisClient *redis.Cluster // Use Redis Cluster client
	meetings   map[string]*Meeting // Map<meetingId, *Meeting>
	meetingsMu sync.RWMutex
	sfuMetrics SFUMetrics
	metricsMu  sync.Mutex
	// This SFU no longer directly connects to a signaling server via WS
	// It communicates with clients *through* the signaling server via Redis Pub/Sub
)

func main() {
	// Get SFU_ID from environment variable set in docker-compose
	sfuID = os.Getenv("SFU_ID")
	if sfuID == "" {
		sfuID = SFUIDPrefix + uuid.New().String()[:8] // Fallback if not set
	}
	log.Printf("SFU starting with ID: %s", sfuID)

	// Setup Redis Cluster
	redisClusterNodesEnv := os.Getenv("REDIS_CLUSTER_NODES")
	if redisClusterNodesEnv == "" {
		log.Fatal("REDIS_CLUSTER_NODES environment variable not set.")
	}
	redisAddrs := splitRedisAddrs(redisClusterNodesEnv)

	redisClient = redis.NewClusterClient(&redis.ClusterOptions{
		Addrs: redisAddrs,
		// Add other options like password, TLS if needed
	})

	ctx := context.Background()
	_, err := redisClient.Ping(ctx).Result()
	if err != nil {
		log.Fatalf("Could not connect to Redis Cluster: %v", err)
	}
	log.Println("SFU: Connected to Redis Cluster.")

	meetings = make(map[string]*Meeting)
	sfuMetrics = SFUMetrics{} // Initialize metrics

	// Register SFU's availability in Redis
	// This is done once at startup, and then heartbeats update metrics
	err = redisClient.SAdd(ctx, "available_sfus", sfuID).Err()
	if err != nil {
		log.Fatalf("SFU: Failed to add SFU to available_sfus set in Redis: %v", err)
	}
	log.Printf("SFU: Registered %s as available in Redis.", sfuID)

	// Start goroutine to receive commands from Orchestration/Signaling via Redis Pub/Sub
	go listenToRedisCommands()

	// Start goroutine to send periodic heartbeats
	go sendHeartbeats()

	// Keep SFU running
	select {} // Block forever
}

func splitRedisAddrs(addrs string) []string {
	var result []string
	for _, addr := range strings.Split(addrs, ",") {
		result = append(result, strings.TrimSpace(addr))
	}
	return result
}

// listenToRedisCommands subscribes to SFU-specific commands from the Orchestration Service
func listenToRedisCommands() {
	ctx := context.Background()
	pubsub := redisClient.Subscribe(ctx, fmt.Sprintf("sfu_commands:%s", sfuID))
	defer pubsub.Close()

	log.Printf("SFU: Subscribed to Redis channel %s", fmt.Sprintf("sfu_commands:%s", sfuID))

	for msg := range pubsub.Channel() {
		log.Printf("SFU: Received Redis command on channel %s: %s", msg.Channel, msg.Payload)
		var wsMsg WSMessage // Use WSMessage struct for incoming commands
		err := json.Unmarshal([]byte(msg.Payload), &wsMsg)
		if err != nil {
			log.Printf("SFU: Error unmarshalling Redis command: %v", err)
			continue
		}

		// The payload of the Redis message is the actual command for the SFU
		cmdType := wsMsg.Payload.(map[string]interface{})["type"].(string)
		cmdPayload := wsMsg.Payload.(map[string]interface{})["payload"].(map[string]interface{})
		meetingID := cmdPayload["meetingId"].(string)

		meetingsMu.Lock()
		meeting, exists := meetings[meetingID]
		if !exists {
			meeting = &Meeting{
				ID:        meetingID,
				clients:   make(map[string]*ClientPeer),
				trackLocals: make(map[string]*webrtc.TrackLocalStaticRTP),
			}
			meetings[meetingID] = meeting
			log.Printf("SFU: Created new meeting instance for %s on SFU %s", meetingID, sfuID)
		}
		meetingsMu.Unlock()

		switch cmdType {
		case "prepareMeeting":
			log.Printf("SFU: Preparing meeting %s", meetingID)
			// No specific action needed here beyond creating the meeting object
		case "clientJoined":
			clientID := cmdPayload["clientId"].(string)
			log.Printf("SFU: Client %s joined meeting %s. Setting up PeerConnection.", clientID, meetingID)
			go setupClientPeerConnection(meeting, clientID)
			metricsMu.Lock()
			sfuMetrics.ConnectedClients++
			if len(meeting.clients) == 0 { // First client in this meeting on this SFU
				sfuMetrics.ActiveMeetings++
			}
			metricsMu.Unlock()
		case "clientLeft":
			clientID := cmdPayload["clientId"].(string)
			log.Printf("SFU: Client %s left meeting %s. Cleaning up PeerConnection.", clientID, meetingID)
			meeting.mu.Lock()
			if peer, ok := meeting.clients[clientID]; ok {
				peer.PeerConnection.Close()
				delete(meeting.clients, clientID)
				metricsMu.Lock()
				sfuMetrics.ConnectedClients--
				if len(meeting.clients) == 0 { // Last client in this meeting on this SFU
					sfuMetrics.ActiveMeetings--
				}
				metricsMu.Unlock()
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
			signalType := cmdPayload["type"].(string)
			senderID := cmdPayload["senderId"].(string)

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
				sdpStr := cmdPayload["sdp"].(string)
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
				candidateMap := cmdPayload["candidate"].(map[string]interface{})
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
			log.Printf("SFU: Unhandled SFU command type: %s", cmdType)
		}
	}
}

func setupClientPeerConnection(meeting *Meeting, clientID string) {
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		log.Printf("SFU Error creating PeerConnection for %s: %v", clientID, err)
		return
	}

	clientPeer := &ClientPeer{
		ID:           clientID,
		MeetingID:    meeting.ID,
		PeerConnection: peerConnection,
	}

	meeting.mu.Lock()
	meeting.clients[clientID] = clientPeer
	meeting.mu.Unlock()

	peerConnection.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		log.Printf("SFU generated ICE candidate for client %s", clientID)
		sendSFUSignalToClient(clientID, "candidate", "", c, meeting.ID)
	})

	peerConnection.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		log.Printf("SFU Peer Connection State for %s: %s", clientID, s.String())
		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			log.Printf("SFU PeerConnection for client %s closed or failed.", clientID)
			meeting.mu.Lock()
			if _, ok := meeting.clients[clientID]; ok {
				delete(meeting.clients, clientID)
				metricsMu.Lock()
				sfuMetrics.ConnectedClients--
				if len(meeting.clients) == 0 {
					sfuMetrics.ActiveMeetings--
				}
				metricsMu.Unlock()
			}
			meeting.mu.Unlock()
		}
	})

	peerConnection.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("SFU received track from client %s: %s, kind: %s", clientID, remoteTrack.ID(), remoteTrack.Kind().String())

		trackLocal, newTrackErr := webrtc.NewTrackLocalStaticRTP(remoteTrack.Codec().RTPCodecCapability, remoteTrack.ID(), remoteTrack.StreamID())
		if newTrackErr != nil {
			log.Printf("SFU Error creating local track: %v", newTrackErr)
			return
		}

		meeting.mu.Lock()
		meeting.trackLocals[remoteTrack.ID()] = trackLocal
		meeting.mu.Unlock()

		meeting.mu.RLock()
		for _, existingClientPeer := range meeting.clients {
			if existingClientPeer.ID != clientID { // Don't send back to sender
				addTrackToPeer(existingClientPeer.PeerConnection, trackLocal)
			}
		}
		meeting.mu.RUnlock()

		rtpBuf := make([]byte, 1500)
		for {
			i, _, readErr := remoteTrack.Read(rtpBuf)
			if readErr != nil {
				log.Printf("SFU Error reading from remote track %s: %v", remoteTrack.ID(), readErr)
				meeting.mu.Lock()
				delete(meeting.trackLocals, remoteTrack.ID())
				meeting.mu.Unlock()
				return
			}

			if _, writeErr := trackLocal.Write(rtpBuf[:i]); writeErr != nil {
				log.Printf("SFU Error writing to local track %s: %v", remoteTrack.ID(), writeErr)
				return
			}
		}
	})

	meeting.mu.RLock()
	for _, trackLocal := range meeting.trackLocals {
		addTrackToPeer(peerConnection, trackLocal)
	}
	meeting.mu.RUnlock()
}

func addTrackToPeer(pc *webrtc.PeerConnection, trackLocal *webrtc.TrackLocalStaticRTP) {
	_, err := pc.AddTransceiverFromKind(trackLocal.Kind(), webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendonly,
	})
	if err != nil {
		log.Printf("SFU Error adding transceiver for track %s: %v", trackLocal.ID(), err)
		return
	}

	_, err = pc.AddTrack(trackLocal)
	if err != nil {
		log.Printf("SFU Error adding track %s to peer connection: %v", trackLocal.ID(), err)
		return
	}
	log.Printf("SFU added track %s to peer connection for client", trackLocal.ID())

	log.Printf("SFU needs to renegotiate for added track %s", trackLocal.ID())
}

// sendSFUSignalToClient sends signals from SFU to a specific client via Redis Pub/Sub
// The Signaling Server will be subscribed to this channel and forward to the client's WebSocket
func sendSFUSignalToClient(clientID string, signalType string, sdp string, candidate *webrtc.ICECandidate, meetingID string) {
	// First, find which signaling server this client is connected to
	ctx := context.Background()
	signalingServerURL, err := redisClient.HGet(ctx, fmt.Sprintf("user:%s:presence", clientID), "signaling_server_id").Result()
	if err != nil {
		log.Printf("SFU: Could not find signaling server for client %s: %v", clientID, err)
		return
	}

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
		Type:    "sfuSignalToClient", // This type tells the signaling server what to do
		Payload: msgPayload,
		SenderID: sfuID,
	}

	msgJSON, err := json.Marshal(wsMsg)
	if err != nil {
		log.Printf("SFU: Error marshalling SFU signal to client: %v", err)
		return
	}

	// Publish to a channel that the specific signaling server is listening to
	// This assumes signaling servers subscribe to a channel like 'signaling_server_inbox:<signaling_server_id>'
	// For this demo, we'll use a generic 'sfu_signals_to_clients' channel that the signaling server listens to.
	// In a more complex setup, you might have direct channels for each signaling server.
	// For now, the signaling server listens to ALL sfu_commands and sfu_signals_to_clients.
	err = redisClient.Publish(ctx, "sfu_signals_to_clients", string(msgJSON)).Err()
	if err != nil {
		log.Printf("SFU: Error publishing SFU signal to client %s via Redis: %v", clientID, err)
	}
}

func sendHeartbeats() {
	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()
	ctx := context.Background()

	for range ticker.C {
		metricsMu.Lock()
		sfuMetrics.LastHeartbeat = time.Now().UnixMilli()
		currentMetrics := sfuMetrics // Copy for sending
		metricsMu.Unlock()

		// Update metrics in Redis
		err := redisClient.HMSet(ctx, fmt.Sprintf("sfu:%s:metrics", sfuID),
			"connected_clients", currentMetrics.ConnectedClients,
			"active_meetings", currentMetrics.ActiveMeetings,
			"last_heartbeat", currentMetrics.LastHeartbeat,
		).Err()
		if err != nil {
			log.Printf("SFU Error sending heartbeat to Redis: %v", err)
		}

		// Also publish to a pub/sub channel for other services to consume (e.g., Orchestration)
		heartbeatMsg := WSMessage{
			Type: "sfuHeartbeat",
			Payload: map[string]interface{}{
				"sfuId":    sfuID,
				"metrics": currentMetrics,
			},
		}
		heartbeatJSON, _ := json.Marshal(heartbeatMsg)
		err = redisClient.Publish(ctx, "sfu_heartbeats", string(heartbeatJSON)).Err()
		if err != nil {
			log.Printf("SFU Error publishing heartbeat to Redis Pub/Sub: %v", err)
		}
		// log.Printf("SFU %s sent heartbeat. Clients: %d, Meetings: %d", sfuID, currentMetrics.ConnectedClients, currentMetrics.ActiveMeetings)
	}
}

