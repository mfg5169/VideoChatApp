package main

import (
	"fmt"
	"log"
	"runtime"
	"strings"
	"sync"
	"time"
)

// LogLevel represents the logging level
type LogLevel int

const (
	DEBUG LogLevel = iota
	INFO
	WARN
	ERROR
)

// String returns the string representation of the log level
func (l LogLevel) String() string {
	switch l {
	case DEBUG:
		return "DEBUG"
	case INFO:
		return "INFO"
	case WARN:
		return "WARN"
	case ERROR:
		return "ERROR"
	default:
		return "UNKNOWN"
	}
}

// Logger represents a structured logger for the SFU
type Logger struct {
	mu        sync.RWMutex
	level     LogLevel
	sfuID     string
	startTime time.Time
	stats     *LoggerStats
}

// LoggerStats tracks logging statistics
type LoggerStats struct {
	mu             sync.RWMutex
	totalLogs      int64
	logsByLevel    map[LogLevel]int64
	lastError      error
	lastErrorTime  time.Time
	componentStats map[string]int64
}

// NewLogger creates a new logger instance
func NewLogger(sfuID string, level LogLevel) *Logger {
	stats := &LoggerStats{
		logsByLevel:    make(map[LogLevel]int64),
		componentStats: make(map[string]int64),
	}

	return &Logger{
		level:     level,
		sfuID:     sfuID,
		startTime: time.Now(),
		stats:     stats,
	}
}

// formatMessage formats a log message with timestamp, level, component, and SFU ID
func (l *Logger) formatMessage(level LogLevel, component, message string, data interface{}) string {
	timestamp := time.Now().Format("2006-01-02T15:04:05.000Z07:00")

	// Get caller information for better debugging
	_, file, line, ok := runtime.Caller(3)
	caller := "unknown"
	if ok {
		// Extract just the filename from the full path
		for i := len(file) - 1; i >= 0; i-- {
			if file[i] == '/' || file[i] == '\\' {
				file = file[i+1:]
				break
			}
		}
		caller = fmt.Sprintf("%s:%d", file, line)
	}

	// Try to get function name as well
	pc, _, _, ok := runtime.Caller(3)
	funcName := "unknown"
	if ok {
		if fn := runtime.FuncForPC(pc); fn != nil {
			// Extract just the function name from the full path
			fullName := fn.Name()
			if idx := strings.LastIndex(fullName, "."); idx != -1 {
				funcName = fullName[idx+1:]
			} else {
				funcName = fullName
			}
		}
	}

	baseMsg := fmt.Sprintf("[%s] [%s] [%s] [%s] [%s@%s] %s",
		timestamp, level.String(), component, l.sfuID, funcName, caller, message)

	if data != nil {
		baseMsg += fmt.Sprintf(" | Data: %+v", data)
	}

	return baseMsg
}

// updateStats updates logging statistics
func (l *Logger) updateStats(level LogLevel, component string) {
	l.stats.mu.Lock()
	defer l.stats.mu.Unlock()

	l.stats.totalLogs++
	l.stats.logsByLevel[level]++
	l.stats.componentStats[component]++

	if level == ERROR {
		l.stats.lastErrorTime = time.Now()
	}
}

// log writes a log message if the level is sufficient
func (l *Logger) log(level LogLevel, component, message string, data interface{}) {
	if level < l.level {
		return
	}

	l.updateStats(level, component)
	formattedMsg := l.formatMessage(level, component, message, data)

	switch level {
	case DEBUG:
		log.Printf("[DEBUG] %s", formattedMsg)
	case INFO:
		log.Printf("[INFO] %s", formattedMsg)
	case WARN:
		log.Printf("[WARN] %s", formattedMsg)
	case ERROR:
		log.Printf("[ERROR] %s", formattedMsg)
	}
}

// Debug logs a debug message
func (l *Logger) Debug(component, message string, data interface{}) {
	l.log(DEBUG, component, message, data)
}

// Info logs an info message
func (l *Logger) Info(component, message string, data interface{}) {
	l.log(INFO, component, message, data)
}

// Warn logs a warning message
func (l *Logger) Warn(component, message string, data interface{}) {
	l.log(WARN, component, message, data)
}

// Error logs an error message
func (l *Logger) Error(component, message string, err error, data interface{}) {
	if err != nil {
		l.stats.mu.Lock()
		l.stats.lastError = err
		l.stats.mu.Unlock()

		if data == nil {
			data = map[string]interface{}{}
		}
		if dataMap, ok := data.(map[string]interface{}); ok {
			dataMap["error"] = err.Error()
			dataMap["errorType"] = fmt.Sprintf("%T", err)
			data = dataMap
		}
	}

	l.log(ERROR, component, message, data)
}

// GetStats returns current logging statistics
func (l *Logger) GetStats() map[string]interface{} {
	l.stats.mu.RLock()
	defer l.stats.mu.RUnlock()

	stats := map[string]interface{}{
		"sfuID":          l.sfuID,
		"startTime":      l.startTime.Format(time.RFC3339),
		"uptime":         time.Since(l.startTime).String(),
		"totalLogs":      l.stats.totalLogs,
		"logsByLevel":    l.stats.logsByLevel,
		"componentStats": l.stats.componentStats,
		"lastErrorTime":  l.stats.lastErrorTime.Format(time.RFC3339),
	}

	if l.stats.lastError != nil {
		stats["lastError"] = l.stats.lastError.Error()
	}

	return stats
}

// SetLevel changes the logging level
func (l *Logger) SetLevel(level LogLevel) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.level = level
}

// GetLevel returns the current logging level
func (l *Logger) GetLevel() LogLevel {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.level
}

// SFUState tracks the overall state of the SFU
type SFUState struct {
	mu               sync.RWMutex
	startTime        time.Time
	sfuID            string
	status           string
	connectedClients int64
	activeMeetings   int64
	totalMeetings    int64
	totalClients     int64
	totalErrors      int64
	lastHeartbeat    time.Time
	kafkaConnected   bool
	redisConnected   bool
	wsConnected      bool
}

// NewSFUState creates a new SFU state tracker
func NewSFUState(sfuID string) *SFUState {
	return &SFUState{
		startTime: time.Now(),
		sfuID:     sfuID,
		status:    "initializing",
	}
}

// UpdateStatus updates the SFU status
func (s *SFUState) UpdateStatus(status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = status
}

// UpdateMetrics updates SFU metrics
func (s *SFUState) UpdateMetrics(connectedClients, activeMeetings int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connectedClients = connectedClients
	s.activeMeetings = activeMeetings
}

// IncrementCounters increments various counters
func (s *SFUState) IncrementCounters(meetings, clients, errors int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.totalMeetings += meetings
	s.totalClients += clients
	s.totalErrors += errors
}

// UpdateConnections updates connection status
func (s *SFUState) UpdateConnections(kafka, redis, ws bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.kafkaConnected = kafka
	s.redisConnected = redis
	s.wsConnected = ws
}

// UpdateHeartbeat updates the last heartbeat time
func (s *SFUState) UpdateHeartbeat() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastHeartbeat = time.Now()
}

// GetState returns the current SFU state
func (s *SFUState) GetState() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return map[string]interface{}{
		"sfuID":            s.sfuID,
		"startTime":        s.startTime.Format(time.RFC3339),
		"uptime":           time.Since(s.startTime).String(),
		"status":           s.status,
		"connectedClients": s.connectedClients,
		"activeMeetings":   s.activeMeetings,
		"totalMeetings":    s.totalMeetings,
		"totalClients":     s.totalClients,
		"totalErrors":      s.totalErrors,
		"lastHeartbeat":    s.lastHeartbeat.Format(time.RFC3339),
		"connections": map[string]bool{
			"kafka":     s.kafkaConnected,
			"redis":     s.redisConnected,
			"websocket": s.wsConnected,
		},
	}
}

// Global logger and state instances
var (
	sfuLogger *Logger
	sfuState  *SFUState
)

// initLogger initializes the global logger
func initLogger() {
	// The sfuID is now set in the config, but the logger is initialized before the config.
	// We'll create a temporary logger, then re-initialize it after config is loaded.
	// This is a bit of a workaround for dependency ordering. A better solution might involve
	// passing the logger around instead of using a global, but for this refactor, we'll stick to the existing pattern.

	// A minimal logger to start
	sfuLogger = NewLogger("", INFO)
	sfuState = NewSFUState("")
}

// reinitLogger updates the logger and state with the final SFU ID and log level from config.
func reinitLogger() {
	sfuLogger.sfuID = C.SFUID
	sfuLogger.SetLevel(C.LogLevel)
	sfuState.sfuID = C.SFUID

	sfuLogger.Info("LOGGER", "SFU logger re-initialized with final config", map[string]interface{}{
		"level": C.LogLevel.String(),
		"sfuID": C.SFUID,
	})
}
