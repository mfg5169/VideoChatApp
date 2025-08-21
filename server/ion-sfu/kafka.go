package main

import (
	"log"

	"github.com/IBM/sarama"
)

func initKafka() {
	var err error
	config := sarama.NewConfig()
	config.Producer.RequiredAcks = sarama.WaitForAll
	config.Producer.Retry.Max = 5
	config.Producer.Return.Successes = true

	producer, err = sarama.NewSyncProducer([]string{"kafka1:9092", "kafka2:9093", "kafka3:9094"}, config)
	if err != nil {
		log.Printf("Failed to create Kafka producer: %v", err)
		return
	}
	log.Println("SFU: Kafka producer initialized successfully")
}
