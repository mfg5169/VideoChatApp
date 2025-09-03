package main

import (
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pion/webrtc/v3"
)

// Config holds the configuration for the SFU
type Config struct {
	SFUID               string
	LogLevel            LogLevel
	SignalingURL        string
	RedisClusterNodes   []string
	KafkaBrokers        []string
	ICEServers          []webrtc.ICEServer
	HeartbeatInterval   time.Duration
	RedisPoolSize       int
	RedisMinIdleConns   int
	RedisMaxRetries     int
	KafkaMaxRetries     int
	KafkaRetryMax       int
	WSReconnectDelay    time.Duration
	RedisReconnectDelay time.Duration
}

// C is the global configuration object
var C Config

// initConfig initializes the configuration by reading from environment variables
func initConfig() {
	sfuLogger.Info("CONFIG", "Loading configuration from environment variables", nil)

	C = Config{
		SFUID:               getEnv("SFU_ID", SFUIDPrefix+generateRandomID()),
		LogLevel:            getLogLevelEnv("SFU_LOG_LEVEL", DEBUG),
		SignalingURL:        getEnv("SIGNALING_SERVER_URL", "ws://localhost:8080"),
		RedisClusterNodes:   getEnvSlice("REDIS_CLUSTER_NODES", "localhost:7000,localhost:7001,localhost:7002"),
		KafkaBrokers:        getEnvSlice("KAFKA_BROKERS", "kafka1:9092,kafka2:9093,kafka3:9094"),
		HeartbeatInterval:   5 * time.Second,
		RedisPoolSize:       10,
		RedisMinIdleConns:   5,
		RedisMaxRetries:     3,
		KafkaMaxRetries:     5,
		KafkaRetryMax:       5,
		WSReconnectDelay:    5 * time.Second,
		RedisReconnectDelay: 2 * time.Second,
		ICEServers: []webrtc.ICEServer{
			{URLs: getEnvSlice("STUN_SERVERS", "stun:stun.l.google.com:19302")},
		},
	}

	sfuLogger.Info("CONFIG", "Configuration loaded", map[string]interface{}{
		"SFUID":             C.SFUID,
		"LogLevel":          C.LogLevel.String(),
		"SignalingURL":      C.SignalingURL,
		"RedisClusterNodes": C.RedisClusterNodes,
		"KafkaBrokers":      C.KafkaBrokers,
		"ICEServers":        C.ICEServers,
	})
}

// generateRandomID creates a short unique ID
func generateRandomID() string {
	return uuid.New().String()[:8]
}

// getEnv reads an environment variable or returns a default value
func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	sfuLogger.Debug("CONFIG", "Environment variable not set, using fallback", map[string]interface{}{
		"key":      key,
		"fallback": fallback,
	})
	return fallback
}

// getEnvSlice reads a comma-separated environment variable or returns a default slice
func getEnvSlice(key, fallback string) []string {
	value := getEnv(key, fallback)
	return strings.Split(value, ",")
}

// getLogLevelEnv reads the log level from an environment variable
func getLogLevelEnv(key string, fallback LogLevel) LogLevel {
	value := getEnv(key, fallback.String())
	switch strings.ToUpper(value) {
	case "DEBUG":
		return DEBUG
	case "INFO":
		return INFO
	case "WARN":
		return WARN
	case "ERROR":
		return ERROR
	default:
		sfuLogger.Warn("CONFIG", "Invalid log level specified, using fallback", map[string]interface{}{
			"key":      key,
			"value":    value,
			"fallback": fallback.String(),
		})
		return fallback
	}
}
