package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func initRedis() {
	sfuLogger.Info("REDIS", "Starting Redis initialization", map[string]interface{}{
		"sfuID":       sfuID,
		"sfuIDSource": "environment",
	})

	sfuLogger.Info("REDIS", "Configuring Redis Cluster", map[string]interface{}{
		"redisAddrs":   C.RedisClusterNodes,
		"poolSize":     C.RedisPoolSize,
		"minIdleConns": C.RedisMinIdleConns,
		"maxRetries":   C.RedisMaxRetries,
	})

	redisClient = redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:          C.RedisClusterNodes,
		PoolSize:       C.RedisPoolSize,
		MinIdleConns:   C.RedisMinIdleConns,
		MaxRetries:     C.RedisMaxRetries,
		RouteByLatency: false,
		RouteRandomly:  false,
	})

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
			"retryDelay": C.RedisReconnectDelay.String(),
		})
		time.Sleep(C.RedisReconnectDelay)
	}
}

func sendHeartbeats() {
	sfuLogger.Info("HEARTBEAT", "Starting heartbeat system", map[string]interface{}{
		"sfuID":    sfuID,
		"interval": C.HeartbeatInterval.String(),
	})

	ticker := time.NewTicker(C.HeartbeatInterval)
	defer ticker.Stop()
	ctx := context.Background()
	heartbeatCount := int64(0)

	for range ticker.C {
		heartbeatCount++
		// sfuLogger.Debug("HEARTBEAT", "Sending heartbeat", map[string]interface{}{
		// 	"heartbeatCount": heartbeatCount,
		// 	"sfuID":          sfuID,
		// })

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
		// sfuLogger.Debug("HEARTBEAT", "Heartbeat sent successfully", map[string]interface{}{
		// 	"sfuID":            sfuID,
		// 	"heartbeatCount":   heartbeatCount,
		// 	"connectedClients": currentMetrics.ConnectedClients,
		// 	"activeMeetings":   currentMetrics.ActiveMeetings,
		// })
	}
}
