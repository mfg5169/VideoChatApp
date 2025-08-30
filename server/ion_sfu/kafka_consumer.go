package main

import (
	"fmt"
	"time"

	"github.com/IBM/sarama"
)

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
	maxRetries := C.KafkaMaxRetries
	brokers := C.KafkaBrokers

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
	maxRetries := C.KafkaMaxRetries

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
