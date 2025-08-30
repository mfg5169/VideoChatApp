package main

import (
	"context"
	"log"
	"runtime"
	"sync"
	"time"

	"github.com/IBM/sarama"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

var (
	producer sarama.SyncProducer
	wsConn   *websocket.Conn
)

var (
	sfuID        string
	redisClient  *redis.ClusterClient // Use Redis Cluster client for production
	meetings     map[string]*Meeting  // Map<meetingId, *Meeting>
	meetingsMu   sync.RWMutex
	sfuMetrics   SFUMetrics
	metricsMu    sync.Mutex
	ctx          = context.Background()
	signalingURL string
)

func init() {
	// Initialize logger first, with a temporary configuration
	initLogger()

	// Now load the full configuration from environment variables
	initConfig()

	// Re-initialize the logger with the final configuration
	reinitLogger()

	// Set package-level variables from the config
	sfuID = C.SFUID
	signalingURL = C.SignalingURL

	sfuLogger.Info("INIT", "SFU initialization started", map[string]interface{}{
		"sfuID":     sfuID,
		"goVersion": runtime.Version(),
		"platform":  runtime.GOOS + "/" + runtime.GOARCH,
	})

	sfuState.UpdateStatus("initializing")

	// Initialize components with detailed logging
	sfuLogger.Info("INIT", "Initializing Redis connection", nil)
	initRedis()

	sfuLogger.Info("INIT", "Initializing Kafka connection", nil)
	initKafka()

	sfuLogger.Info("INIT", "Connecting to signaling server", nil)
	connectToSignalingServer() // Connect to signaling server on startup

	sfuState.UpdateStatus("ready")
	sfuLogger.Info("INIT", "SFU initialization completed", sfuState.GetState())
}

func main() {
	sfuLogger.Info("MAIN", "SFU main function started", map[string]interface{}{
		"sfuID": sfuID,
	})

	meetings = make(map[string]*Meeting)
	sfuMetrics = SFUMetrics{} // Initialize metrics

	// Production: Register SFU's availability in Redis Cluster with retry logic
	// This is done once at startup, and then heartbeats update metrics
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		sfuLogger.Info("MAIN", "Attempting Redis registration", map[string]interface{}{
			"attempt":    attempt,
			"maxRetries": maxRetries,
			"sfuID":      sfuID,
		})

		err := redisClient.SAdd(ctx, "available_sfus", sfuID).Err()
		if err == nil {
			sfuLogger.Info("MAIN", "Successfully registered SFU in Redis Cluster", map[string]interface{}{
				"sfuID":   sfuID,
				"attempt": attempt,
			})
			sfuState.UpdateConnections(true, true, false) // Kafka, Redis, WebSocket
			break
		}

		if attempt == maxRetries {
			sfuLogger.Error("MAIN", "Failed to register in Redis Cluster after maximum attempts", err, map[string]interface{}{
				"maxRetries": maxRetries,
				"sfuID":      sfuID,
			})
			sfuState.IncrementCounters(0, 0, 1)
			log.Fatalf("SFU main.go:: main: Failed to register in Redis Cluster after %d attempts: %v", maxRetries, err)
		}

		sfuLogger.Warn("MAIN", "Redis Cluster registration attempt failed, retrying", map[string]interface{}{
			"attempt":    attempt,
			"error":      err.Error(),
			"retryDelay": "1s",
		})
		time.Sleep(1 * time.Second)
	}

	// Start goroutine to receive commands from Orchestration/Signaling via Redis Pub/Sub
	sfuLogger.Info("MAIN", "Starting Kafka command listener", nil)
	go listenToKafkaCommands()

	// Start goroutine to send periodic heartbeats
	sfuLogger.Info("MAIN", "Starting heartbeat system", map[string]interface{}{
		"heartbeatInterval": HeartbeatInterval.String(),
	})
	go sendHeartbeats()

	sfuState.UpdateStatus("running")
	sfuLogger.Info("MAIN", "SFU is now running and ready to handle meetings", sfuState.GetState())

	// Keep SFU running
	select {} // Block forever
}
