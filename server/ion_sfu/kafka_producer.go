package main

import (
	"github.com/IBM/sarama"
)

func initKafka() {
	sfuLogger.Info("KAFKA", "Initializing Kafka producer", map[string]interface{}{
		"brokers": C.KafkaBrokers,
		"sfuID":   sfuID,
	})

	var err error
	config := sarama.NewConfig()
	config.Producer.RequiredAcks = sarama.WaitForAll
	config.Producer.Retry.Max = C.KafkaRetryMax
	config.Producer.Return.Successes = true

	sfuLogger.Debug("KAFKA", "Kafka configuration", map[string]interface{}{
		"requiredAcks":    config.Producer.RequiredAcks,
		"retryMax":        config.Producer.Retry.Max,
		"returnSuccesses": config.Producer.Return.Successes,
	})

	producer, err = sarama.NewSyncProducer(C.KafkaBrokers, config)
	if err != nil {
		sfuLogger.Error("KAFKA", "Failed to create Kafka producer", err, map[string]interface{}{
			"brokers": C.KafkaBrokers,
			"sfuID":   sfuID,
		})
		sfuState.IncrementCounters(0, 0, 1)
		sfuState.UpdateConnections(false, true, false) // Kafka failed, Redis assumed true
		return
	}

	sfuLogger.Info("KAFKA", "Kafka producer initialized successfully", map[string]interface{}{
		"sfuID": sfuID,
	})
	sfuState.UpdateConnections(true, true, false) // Kafka success, Redis assumed true
}
