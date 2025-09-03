package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/IBM/sarama"
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
	sfuLogger.Info("REDIS", "Starting Redis initialization", map[string]interface{}{
		"sfuID":       sfuID,
		"sfuIDSource": "environment",
	})

	// Get signaling server URL
	signalingURL = os.Getenv("SIGNALING_SERVER_URL")
	if signalingURL == "" {
		signalingURL = "ws://localhost:8080" // Default fallback
		sfuLogger.Warn("REDIS", "Using default signaling server URL", map[string]interface{}{
			"signalingURL": signalingURL,
		})
	}

	// Setup Redis Cluster
	redisClusterNodesEnv := os.Getenv("REDIS_CLUSTER_NODES")
	if redisClusterNodesEnv == "" {
		sfuLogger.Error("REDIS", "REDIS_CLUSTER_NODES environment variable not set", nil, nil)
		sfuState.IncrementCounters(0, 0, 1)
		panic("REDIS_CLUSTER_NODES environment variable not set")
	}
	redisAddrs := splitRedisAddrs(redisClusterNodesEnv)

	sfuLogger.Info("REDIS", "Configuring Redis Cluster", map[string]interface{}{
		"redisAddrs":   redisAddrs,
		"poolSize":     10,
		"minIdleConns": 5,
		"maxRetries":   3,
	})

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
		sfuLogger.Info("REDIS", "Attempting Redis Cluster connection", map[string]interface{}{
			"attempt":    attempt,
			"maxRetries": maxRetries,
			"sfuID":      sfuID,
		})

		_, err := redisClient.Ping(ctx).Result()
		if err == nil {
			sfuLogger.Info("REDIS", "Successfully connected to Redis Cluster", map[string]interface{}{
				"attempt": attempt,
				"sfuID":   sfuID,
			})
			sfuState.UpdateConnections(true, true, false) // Kafka, Redis, WebSocket
			break
		}

		if attempt == maxRetries {
			sfuLogger.Error("REDIS", "Could not connect to Redis Cluster after maximum attempts", err, map[string]interface{}{
				"maxRetries": maxRetries,
				"sfuID":      sfuID,
			})
			sfuState.IncrementCounters(0, 0, 1)
			panic(fmt.Sprintf("Could not connect to Redis Cluster after %d attempts: %v", maxRetries, err))
		}

		sfuLogger.Warn("REDIS", "Redis Cluster connection attempt failed, retrying", map[string]interface{}{
			"attempt":    attempt,
			"error":      err.Error(),
			"retryDelay": "2s",
		})
		time.Sleep(2 * time.Second)
	}
}

// listenToKafkaCommands subscribes to SFU-specific commands from the Orchestration Service via Kafka
func listenToKafkaCommands() {
	sfuLogger.Info("KAFKA", "Starting Kafka command listener", map[string]interface{}{
		"sfuID": sfuID,
		"topic": "sfu_commands",
	})

	partitionConsumers, err := setupKafkaConsumer()
	if err != nil {
		sfuLogger.Error("KAFKA", "Failed to setup Kafka consumer", err, map[string]interface{}{
			"sfuID": sfuID,
		})
		return
	}
	defer func() {
		for _, consumer := range partitionConsumers {
			consumer.Close()
		}
	}()

	sfuLogger.Info("KAFKA", "Successfully subscribed to Kafka topic", map[string]interface{}{
		"topic":          "sfu_commands",
		"partitionCount": len(partitionConsumers),
		"sfuID":          sfuID,
	})

	sfuState.UpdateConnections(true, true, false) // Kafka success, Redis assumed true

	messageCount := int64(0)

	// Create a channel to receive messages from all partitions
	messageChan := make(chan *sarama.ConsumerMessage, 100)

	// Start goroutines to consume from each partition
	for i, partitionConsumer := range partitionConsumers {
		go func(partitionIndex int, consumer sarama.PartitionConsumer) {
			sfuLogger.Info("KAFKA", "Starting partition consumer goroutine", map[string]interface{}{
				"partition": partitionIndex,
				"sfuID":     sfuID,
			})
			for msg := range consumer.Messages() {
				messageChan <- msg
			}
		}(i, partitionConsumer)
	}

	// Process messages from all partitions
	for msg := range messageChan {
		messageCount++
		processKafkaMessage(msg, messageCount)
	}
}

// setupKafkaConsumer creates and configures the Kafka consumer with retry logic
func setupKafkaConsumer() ([]sarama.PartitionConsumer, error) {
	config := sarama.NewConfig()
	config.Consumer.Group.Rebalance.Strategy = sarama.BalanceStrategyRoundRobin
	config.Consumer.Offsets.Initial = sarama.OffsetOldest

	sfuLogger.Debug("KAFKA", "Kafka consumer configuration", map[string]interface{}{
		"rebalanceStrategy": config.Consumer.Group.Rebalance.Strategy,
		"initialOffset":     config.Consumer.Offsets.Initial,
	})

	consumer, err := connectToKafka(config)
	if err != nil {
		return nil, err
	}

	// Get all partitions for the topic
	partitions, err := consumer.Partitions("sfu_commands")
	if err != nil {
		sfuLogger.Error("KAFKA", "Failed to get partitions", err, map[string]interface{}{
			"topic": "sfu_commands",
		})
		return nil, err
	}

	sfuLogger.Info("KAFKA", "Found partitions for topic", map[string]interface{}{
		"topic":      "sfu_commands",
		"partitions": partitions,
		"sfuID":      sfuID,
	})

	var partitionConsumers []sarama.PartitionConsumer

	// Create consumers for all partitions
	for _, partition := range partitions {
		partitionConsumer, err := createPartitionConsumer(consumer, partition)
		if err != nil {
			sfuLogger.Error("KAFKA", "Failed to create partition consumer", err, map[string]interface{}{
				"topic":     "sfu_commands",
				"partition": partition,
			})
			// Close any already created consumers
			for _, pc := range partitionConsumers {
				pc.Close()
			}
			return nil, err
		}
		partitionConsumers = append(partitionConsumers, partitionConsumer)
		sfuLogger.Info("KAFKA", "Created partition consumer", map[string]interface{}{
			"topic":     "sfu_commands",
			"partition": partition,
			"sfuID":     sfuID,
		})
	}

	return partitionConsumers, nil
}

// connectToKafka establishes connection to Kafka with retry logic
func connectToKafka(config *sarama.Config) (sarama.Consumer, error) {
	maxRetries := 5
	brokers := []string{"kafka1:9092", "kafka2:9093", "kafka3:9094"}

	for attempt := 1; attempt <= maxRetries; attempt++ {
		sfuLogger.Info("KAFKA", "Attempting Kafka connection", map[string]interface{}{
			"attempt":    attempt,
			"maxRetries": maxRetries,
			"brokers":    brokers,
			"sfuID":      sfuID,
		})

		consumer, err := sarama.NewConsumer(brokers, config)
		if err == nil {
			sfuLogger.Info("KAFKA", "Successfully connected to Kafka", map[string]interface{}{
				"attempt": attempt,
				"sfuID":   sfuID,
			})
			return consumer, nil
		}

		if attempt == maxRetries {
			sfuLogger.Error("KAFKA", "Could not connect to Kafka after maximum attempts", err, map[string]interface{}{
				"maxRetries": maxRetries,
				"brokers":    brokers,
				"sfuID":      sfuID,
			})
			sfuState.IncrementCounters(0, 0, 1)
			sfuState.UpdateConnections(false, true, false)
			return nil, err
		}

		sfuLogger.Warn("KAFKA", "Kafka connection attempt failed, retrying", map[string]interface{}{
			"attempt":    attempt,
			"error":      err.Error(),
			"retryDelay": "2s",
		})
		time.Sleep(2 * time.Second)
	}

	return nil, fmt.Errorf("failed to connect to Kafka after maximum attempts")
}

// createPartitionConsumer creates a partition consumer with retry logic
func createPartitionConsumer(consumer sarama.Consumer, partition int32) (sarama.PartitionConsumer, error) {
	maxRetries := 5

	for attempt := 1; attempt <= maxRetries; attempt++ {
		sfuLogger.Info("KAFKA", "Attempting to create partition consumer", map[string]interface{}{
			"attempt":    attempt,
			"maxRetries": maxRetries,
			"topic":      "sfu_commands",
			"partition":  partition,
			"sfuID":      sfuID,
		})

		partitionConsumer, err := consumer.ConsumePartition("sfu_commands", partition, sarama.OffsetOldest)
		if err == nil {
			sfuLogger.Info("KAFKA", "Successfully created partition consumer", map[string]interface{}{
				"attempt":   attempt,
				"topic":     "sfu_commands",
				"partition": partition,
				"sfuID":     sfuID,
			})
			return partitionConsumer, nil
		}

		if attempt == maxRetries {
			sfuLogger.Error("KAFKA", "Could not create partition consumer after maximum attempts", err, map[string]interface{}{
				"maxRetries": maxRetries,
				"topic":      "sfu_commands",
				"partition":  partition,
				"sfuID":      sfuID,
			})
			sfuState.IncrementCounters(0, 0, 1)
			sfuState.UpdateConnections(false, true, false)
			return nil, err
		}

		sfuLogger.Warn("KAFKA", "Partition consumer creation attempt failed, retrying", map[string]interface{}{
			"attempt":    attempt,
			"error":      err.Error(),
			"retryDelay": "1s",
		})
		time.Sleep(1 * time.Second)
	}

	return nil, fmt.Errorf("failed to create partition consumer after maximum attempts")
}

// processKafkaMessage handles individual Kafka messages
func processKafkaMessage(msg *sarama.ConsumerMessage, messageCount int64) {
	sfuLogger.Info("KAFKA", "Received Kafka message", map[string]interface{}{
		"messageCount": messageCount,
		"topic":        msg.Topic,
		"partition":    msg.Partition,
		"offset":       msg.Offset,
		"key":          string(msg.Key),
		"valueLength":  len(msg.Value),
		"sfuID":        sfuID,
		"keyMatches":   string(msg.Key) == sfuID,
	})

	sfuCommand, err := parseKafkaCommand(msg.Value)
	if err != nil {
		sfuLogger.Error("KAFKA", "Error unmarshalling Kafka command", err, map[string]interface{}{
			"messageCount": messageCount,
			"rawValue":     string(msg.Value),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Check if this command is for this SFU
	if string(msg.Key) != sfuID {
		sfuLogger.Debug("KAFKA", "Skipping command not meant for this SFU", map[string]interface{}{
			"messageKey":  string(msg.Key),
			"sfuID":       sfuID,
			"commandType": sfuCommand.Type,
		})
		return
	}

	sfuLogger.Info("KAFKA", "Processing SFU command", map[string]interface{}{
		"commandType": sfuCommand.Type,
		"sfuID":       sfuID,
		"payload":     sfuCommand.Payload,
	})

	meetingID, ok := sfuCommand.Payload["meetingId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid meetingId in Kafka message", nil, map[string]interface{}{
			"commandType": sfuCommand.Type,
			"payload":     sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meeting := getOrCreateMeeting(meetingID)
	handleSFUCommand(sfuCommand, meeting)
}

// parseKafkaCommand unmarshals a Kafka message into an SFUCommand
func parseKafkaCommand(value []byte) (SFUCommand, error) {
	var sfuCommand SFUCommand
	err := json.Unmarshal(value, &sfuCommand)
	return sfuCommand, err
}

// getOrCreateMeeting retrieves an existing meeting or creates a new one
func getOrCreateMeeting(meetingID string) *Meeting {
	meetingsMu.Lock()
	defer meetingsMu.Unlock()

	meeting, exists := meetings[meetingID]
	if !exists {
		meeting = &Meeting{
			ID:          meetingID,
			clients:     make(map[string]*ClientPeer),
			trackLocals: make(map[string]*webrtc.TrackLocalStaticRTP),
		}
		meetings[meetingID] = meeting
		sfuLogger.Info("KAFKA", "Created new meeting instance", map[string]interface{}{
			"meetingID": meetingID,
			"sfuID":     sfuID,
		})
		sfuState.IncrementCounters(1, 0, 0)
	}

	return meeting
}

// handleSFUCommand routes SFU commands to appropriate handlers
func handleSFUCommand(sfuCommand SFUCommand, meeting *Meeting) {
	switch sfuCommand.Type {
	case "prepareMeeting":
		handlePrepareMeeting(meeting)
	case "clientJoined":
		handleClientJoined(sfuCommand, meeting)
	case "clientLeft":
		handleClientLeft(sfuCommand, meeting)
	case "webrtcSignal":
		handleWebRTCSignal(sfuCommand, meeting)
	default:
		sfuLogger.Warn("KAFKA", "Unhandled SFU command type", map[string]interface{}{
			"commandType": sfuCommand.Type,
			"payload":     sfuCommand.Payload,
		})
	}
}

// handlePrepareMeeting processes prepare meeting commands
func handlePrepareMeeting(meeting *Meeting) {
	meetingID := meeting.ID

	sfuLogger.Info("KAFKA", "Processing prepare meeting command", map[string]interface{}{
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})

	// Validate meeting ID
	if meetingID == "" {
		sfuLogger.Error("KAFKA", "Invalid meeting ID for preparation", nil, map[string]interface{}{
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Initialize meeting with metadata
	meeting.mu.Lock()
	meeting.createdAt = time.Now()
	meeting.status = "prepared"
	meeting.maxParticipants = 10
	meeting.mu.Unlock()

	// Update metrics
	metricsMu.Lock()
	sfuMetrics.ActiveMeetings++
	metricsMu.Unlock()

	sfuLogger.Info("KAFKA", "Meeting prepared successfully", map[string]interface{}{
		"meetingID":       meetingID,
		"status":          "prepared",
		"maxParticipants": 10,
		"activeMeetings":  sfuMetrics.ActiveMeetings,
	})
	sfuState.UpdateMetrics(sfuMetrics.ConnectedClients, sfuMetrics.ActiveMeetings)
}

// handleClientJoined processes client joined commands
func handleClientJoined(sfuCommand SFUCommand, meeting *Meeting) {
	clientID, ok := sfuCommand.Payload["clientId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid clientId in clientJoined command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meetingID := meeting.ID

	sfuLogger.Info("KAFKA", "Client joined meeting", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})

	sfuLogger.Info("KAFKA", "Setting up client peer connection", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})
	go setupClientPeerConnection(meeting, clientID)
	metricsMu.Lock()
	sfuMetrics.ConnectedClients++
	if len(meeting.clients) == 0 { // First client in this meeting on this SFU
		sfuMetrics.ActiveMeetings++
	}
	metricsMu.Unlock()

	sfuLogger.Info("KAFKA", "Client join processing completed", map[string]interface{}{
		"clientID":         clientID,
		"meetingID":        meetingID,
		"connectedClients": sfuMetrics.ConnectedClients,
		"activeMeetings":   sfuMetrics.ActiveMeetings,
	})
	sfuState.IncrementCounters(0, 1, 0) // New client
	sfuState.UpdateMetrics(sfuMetrics.ConnectedClients, sfuMetrics.ActiveMeetings)
}

// handleClientLeft processes client left commands
func handleClientLeft(sfuCommand SFUCommand, meeting *Meeting) {
	clientID, ok := sfuCommand.Payload["clientId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid clientId in clientLeft command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meetingID := meeting.ID

	sfuLogger.Info("KAFKA", "Client left meeting", map[string]interface{}{
		"clientID":  clientID,
		"meetingID": meetingID,
		"sfuID":     sfuID,
	})

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

		sfuLogger.Info("KAFKA", "Client cleanup completed", map[string]interface{}{
			"clientID":         clientID,
			"meetingID":        meetingID,
			"remainingClients": len(meeting.clients),
			"connectedClients": sfuMetrics.ConnectedClients,
			"activeMeetings":   sfuMetrics.ActiveMeetings,
		})
	} else {
		sfuLogger.Warn("KAFKA", "Client not found in meeting", map[string]interface{}{
			"clientID":  clientID,
			"meetingID": meetingID,
		})
	}
	meeting.mu.Unlock()

	sfuState.UpdateMetrics(sfuMetrics.ConnectedClients, sfuMetrics.ActiveMeetings)

	// If no clients left in this meeting on this SFU, clean up tracks
	if len(meeting.clients) == 0 {
		meeting.mu.Lock()
		meeting.trackLocals = make(map[string]*webrtc.TrackLocalStaticRTP) // Clear all tracks
		meeting.mu.Unlock()
		sfuLogger.Info("KAFKA", "All clients left meeting, cleared all tracks", map[string]interface{}{
			"meetingID": meetingID,
		})
	}
}

// handleWebRTCSignal processes WebRTC signaling messages
func handleWebRTCSignal(sfuCommand SFUCommand, meeting *Meeting) {
	signalType, ok := sfuCommand.Payload["type"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid type in webrtcSignal command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	senderID, ok := sfuCommand.Payload["senderId"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid senderId in webrtcSignal command", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	meetingID := meeting.ID

	sfuLogger.Debug("KAFKA", "Processing WebRTC signal", map[string]interface{}{
		"signalType": signalType,
		"senderID":   senderID,
		"meetingID":  meetingID,
	})

	peer := waitForPeerConnection(meeting, senderID)
	if peer == nil {
		return
	}

	peer.mu.Lock() // Lock the specific peer connection
	defer peer.mu.Unlock()

	switch signalType {
	case "offer":
		handleOfferSignal(sfuCommand, peer, senderID, meetingID)
	case "answer":
		handleAnswerSignal(sfuCommand, peer, senderID, meetingID)
	case "candidate":
		handleCandidateSignal(sfuCommand, peer, senderID, meetingID)
	}
}

// waitForPeerConnection waits for a peer connection to be available with retry logic
func waitForPeerConnection(meeting *Meeting, senderID string) *ClientPeer {
	maxRetries := 10
	for i := 0; i < maxRetries; i++ {
		meeting.mu.RLock()
		peer, peerExists := meeting.clients[senderID]
		meeting.mu.RUnlock()

		if peerExists {
			return peer
		}

		sfuLogger.Debug("KAFKA", "PeerConnection not found, retrying", map[string]interface{}{
			"senderID":   senderID,
			"meetingID":  meeting.ID,
			"attempt":    i + 1,
			"maxRetries": maxRetries,
		})
		time.Sleep(100 * time.Millisecond) // Wait 100ms before retrying
	}

	sfuLogger.Error("KAFKA", "PeerConnection not found after maximum retries", nil, map[string]interface{}{
		"senderID":   senderID,
		"meetingID":  meeting.ID,
		"maxRetries": maxRetries,
	})
	sfuState.IncrementCounters(0, 0, 1)
	return nil
}

// handleOfferSignal processes offer signals
func handleOfferSignal(sfuCommand SFUCommand, peer *ClientPeer, senderID, meetingID string) {
	sdpStr, ok := sfuCommand.Payload["sdp"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid sdp in offer signal", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  sdpStr,
	}

	sfuLogger.Info("KAFKA", "Received offer from client", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
		"sdpLength": len(sdpStr),
	})

	if err := peer.PeerConnection.SetRemoteDescription(offer); err != nil {
		sfuLogger.Error("KAFKA", "Error setting remote description", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Process any pending ICE candidates
	processPendingCandidates(peer, senderID)

	answer, err := peer.PeerConnection.CreateAnswer(nil)
	if err != nil {
		sfuLogger.Error("KAFKA", "Error creating answer", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	if err := peer.PeerConnection.SetLocalDescription(answer); err != nil {
		sfuLogger.Error("KAFKA", "Error setting local description", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Send answer back to client
	sendSFUSignalToClient(senderID, "answer", answer.SDP, nil, meetingID)
	sfuLogger.Info("KAFKA", "Sent answer to client", map[string]interface{}{
		"senderID":        senderID,
		"meetingID":       meetingID,
		"answerSDPLength": len(answer.SDP),
	})
}

// handleAnswerSignal processes answer signals
func handleAnswerSignal(sfuCommand SFUCommand, peer *ClientPeer, senderID, meetingID string) {
	sdpStr, ok := sfuCommand.Payload["sdp"].(string)
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid sdp in answer signal", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdpStr,
	}

	sfuLogger.Info("KAFKA", "Received answer from client", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
		"sdpLength": len(sdpStr),
	})

	if err := peer.PeerConnection.SetRemoteDescription(answer); err != nil {
		sfuLogger.Error("KAFKA", "Error setting remote description", err, map[string]interface{}{
			"senderID":  senderID,
			"meetingID": meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Info("KAFKA", "Successfully set remote description", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
	})
}

// handleCandidateSignal processes ICE candidate signals
func handleCandidateSignal(sfuCommand SFUCommand, peer *ClientPeer, senderID, meetingID string) {
	candidateMap, ok := sfuCommand.Payload["candidate"].(map[string]interface{})
	if !ok {
		sfuLogger.Error("KAFKA", "Missing or invalid candidate in candidate signal", nil, map[string]interface{}{
			"payload": sfuCommand.Payload,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	candidateJSON, _ := json.Marshal(candidateMap)
	var iceCandidate webrtc.ICECandidate
	if err := json.Unmarshal(candidateJSON, &iceCandidate); err != nil {
		sfuLogger.Error("KAFKA", "Error unmarshalling ICE candidate", err, map[string]interface{}{
			"senderID":     senderID,
			"candidateMap": candidateMap,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Debug("KAFKA", "Received ICE candidate from client", map[string]interface{}{
		"senderID":  senderID,
		"meetingID": meetingID,
		"candidate": iceCandidate.String(),
	})

	// Check if remote description is set before adding ICE candidate
	if peer.PeerConnection.RemoteDescription() == nil {
		sfuLogger.Debug("KAFKA", "Remote description not set yet, buffering ICE candidate", map[string]interface{}{
			"senderID":  senderID,
			"candidate": iceCandidate.String(),
		})
		// Store the candidate to be added later when remote description is set
		if peer.pendingCandidates == nil {
			peer.pendingCandidates = make([]webrtc.ICECandidateInit, 0)
		}
		peer.pendingCandidates = append(peer.pendingCandidates, iceCandidate.ToJSON())
		return
	}

	if err := peer.PeerConnection.AddICECandidate(iceCandidate.ToJSON()); err != nil {
		sfuLogger.Error("KAFKA", "Error adding ICE candidate", err, map[string]interface{}{
			"senderID":  senderID,
			"candidate": iceCandidate.String(),
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	sfuLogger.Debug("KAFKA", "Successfully added ICE candidate", map[string]interface{}{
		"senderID":  senderID,
		"candidate": iceCandidate.String(),
	})
}

// processPendingCandidates processes any pending ICE candidates
func processPendingCandidates(peer *ClientPeer, senderID string) {
	if len(peer.pendingCandidates) > 0 {
		sfuLogger.Info("KAFKA", "Processing pending ICE candidates", map[string]interface{}{
			"senderID":     senderID,
			"pendingCount": len(peer.pendingCandidates),
		})
		for _, candidate := range peer.pendingCandidates {
			if err := peer.PeerConnection.AddICECandidate(candidate); err != nil {
				sfuLogger.Error("KAFKA", "Error adding pending ICE candidate", err, map[string]interface{}{
					"senderID":  senderID,
					"candidate": candidate,
				})
				sfuState.IncrementCounters(0, 0, 1)
			} else {
				sfuLogger.Debug("KAFKA", "Successfully added pending ICE candidate", map[string]interface{}{
					"senderID": senderID,
				})
			}
		}
		// Clear the pending candidates
		peer.pendingCandidates = nil
	}
}

// sendSFUSignalToClient sends signals from SFU to a specific client via Kafka
// The Signaling Server will be subscribed to this topic and forward to the client's WebSocket
func sendSFUSignalToClient(clientID string, signalType string, sdp string, candidate *webrtc.ICECandidate, meetingID string) {
	sfuLogger.Debug("KAFKA", "Sending SFU signal to client", map[string]interface{}{
		"clientID":     clientID,
		"signalType":   signalType,
		"meetingID":    meetingID,
		"hasSDP":       len(sdp) > 0,
		"hasCandidate": candidate != nil,
	})

	// For candidates, we need to convert the webrtc.ICECandidate to the format expected by the client
	var candidateData interface{}
	if candidate != nil {
		// Get the ICECandidateInit from the ToJSON() method to see what fields are available
		candidateInit := candidate.ToJSON()

		// Log the candidate init for debugging
		sfuLogger.Debug("KAFKA", "ICE candidate init", map[string]interface{}{
			"candidateInit": candidateInit,
			"candidateType": fmt.Sprintf("%T", candidateInit),
		})

		sfuLogger.Info("KAFKA", "ICE candidate init", map[string]interface{}{
			"sdpMid":        candidateInit.SDPMid,
			"sdpMLineIndex": candidateInit.SDPMLineIndex,
		})

		// Manually construct the object with JavaScript field names
		// Use default values for sdpMid and sdpMLineIndex since they're not directly accessible
		candidateData = map[string]interface{}{
			"candidate":     candidateInit.Candidate,
			"sdpMid":        candidateInit.SDPMid,
			"sdpMLineIndex": candidateInit.SDPMLineIndex,
		}
	}

	// Construct the message to be published to Kafka
	msgPayload := SFUSignalToClientPayload{
		TargetClientID: clientID,
		SignalType:     signalType,
		SDP:            sdp,
		Candidate:      candidateData,
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
		sfuLogger.Error("KAFKA", "Error marshalling SFU signal to client", err, map[string]interface{}{
			"clientID":   clientID,
			"signalType": signalType,
			"meetingID":  meetingID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		return
	}

	// Send to Kafka topic that the signaling server listens to
	msg := &sarama.ProducerMessage{
		Topic: replyTo,
		Key:   sarama.StringEncoder(clientID),
		Value: sarama.StringEncoder(string(msgJSON)),
	}

	partition, offset, err := producer.SendMessage(msg)
	if err != nil {
		sfuLogger.Error("KAFKA", "Error sending SFU signal to client via Kafka", err, map[string]interface{}{
			"clientID":   clientID,
			"signalType": signalType,
			"meetingID":  meetingID,
			"topic":      "sfu_commands",
		})
		sfuState.IncrementCounters(0, 0, 1)
	} else {
		sfuLogger.Info("KAFKA", "Successfully sent SFU signal to client via Kafka", map[string]interface{}{
			"clientID":    clientID,
			"signalType":  signalType,
			"meetingID":   meetingID,
			"partition":   partition,
			"offset":      offset,
			"messageSize": len(msgJSON),
		})
	}
}

func sendHeartbeats() {
	sfuLogger.Info("HEARTBEAT", "Starting heartbeat system", map[string]interface{}{
		"sfuID":    sfuID,
		"interval": HeartbeatInterval.String(),
	})

	ticker := time.NewTicker(HeartbeatInterval)
	defer ticker.Stop()
	ctx := context.Background()
	heartbeatCount := int64(0)

	for range ticker.C {
		heartbeatCount++
		sfuLogger.Debug("HEARTBEAT", "Sending heartbeat", map[string]interface{}{
			"heartbeatCount": heartbeatCount,
			"sfuID":          sfuID,
		})

		metricsMu.Lock()
		sfuMetrics.LastHeartbeat = time.Now().UnixMilli()
		currentMetrics := sfuMetrics // Copy for sending
		metricsMu.Unlock()

		// Update metrics in Redis Cluster
		err := redisClient.HMSet(ctx, fmt.Sprintf("sfu:%s:metrics", sfuID),
			"connected_clients", currentMetrics.ConnectedClients,
			"active_meetings", currentMetrics.ActiveMeetings,
			"last_heartbeat", currentMetrics.LastHeartbeat,
		).Err()
		if err != nil {
			sfuLogger.Error("HEARTBEAT", "Error sending heartbeat to Redis Cluster", err, map[string]interface{}{
				"sfuID":          sfuID,
				"heartbeatCount": heartbeatCount,
			})
			sfuState.IncrementCounters(0, 0, 1)
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
			sfuLogger.Error("HEARTBEAT", "Error publishing heartbeat to Redis Cluster Pub/Sub", err, map[string]interface{}{
				"sfuID":          sfuID,
				"heartbeatCount": heartbeatCount,
			})
			sfuState.IncrementCounters(0, 0, 1)
		}

		sfuState.UpdateHeartbeat()
		sfuLogger.Debug("HEARTBEAT", "Heartbeat sent successfully", map[string]interface{}{
			"sfuID":            sfuID,
			"heartbeatCount":   heartbeatCount,
			"connectedClients": currentMetrics.ConnectedClients,
			"activeMeetings":   currentMetrics.ActiveMeetings,
		})
	}
}
