package main

import (
	"context"
	"log"
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
	initRedis()
	initKafka()
	connectToSignalingServer() // Connect to signaling server on startup
}

func main() {
	meetings = make(map[string]*Meeting)
	sfuMetrics = SFUMetrics{} // Initialize metrics

	// Production: Register SFU's availability in Redis Cluster with retry logic
	// This is done once at startup, and then heartbeats update metrics
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := redisClient.SAdd(ctx, "available_sfus", sfuID).Err()
		if err == nil {
			log.Printf("SFU: Registered %s as available in Redis Cluster.", sfuID)
			break
		}

		if attempt == maxRetries {
			log.Fatalf("SFU: Failed to register in Redis Cluster after %d attempts: %v", maxRetries, err)
		}

		log.Printf("SFU: Redis Cluster registration attempt %d failed: %v, retrying...", attempt, err)
		time.Sleep(1 * time.Second)
	}

	// Start goroutine to receive commands from Orchestration/Signaling via Redis Pub/Sub
	go listenToRedisCommands()

	// Start goroutine to send periodic heartbeats
	go sendHeartbeats()

	// Keep SFU running
	select {} // Block forever
}
