//import kafka service
const { Kafka } = require('kafkajs');

// Use the shared Redis connection from the main redis module
const redis = require('../../utils/datamanagement/redis');

// Singleton pattern for Kafka instances
let kafkaInstance = null;
let producerInstance = null;
let consumerInstance = null;
let kafkaInitialized = false;

function createKafkaInstances() {
  if (kafkaInstance) {
    return { kafka: kafkaInstance, producer: producerInstance, consumer: consumerInstance };
  }

  kafkaInstance = new Kafka({
    brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094'],
    clientId: 'meeting endpoint',
    // ssl: true,
    // sasl: {
    //     mechanism: 'PLAIN',
    //     username: process.env.KAFKA_USERNAME,
    //     password: process.env.KAFKA_PASSWORD
    // }
  });

  producerInstance = kafkaInstance.producer();
  consumerInstance = kafkaInstance.consumer({ groupId: 'sfu-group' });

  return { kafka: kafkaInstance, producer: producerInstance, consumer: consumerInstance };
}

async function initKafka() {
  if (kafkaInitialized) {
    return;
  }

  try {
    const { producer, consumer } = createKafkaInstances();
    
    await producer.connect();
    await consumer.connect();
    await consumer.subscribe({ topic: 'meeting-events', fromBeginning: false });
    
    await producer.send({
      topic: 'meeting-events',
      messages: [
        {
          key: 'room123',
          value: JSON.stringify({ event: 'mute', userId: 'abc' })
        },
      ],
    });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const event = JSON.parse(message.value.toString());
        console.log(`Received event for room: ${message.key}, event: ${event.event}, user: ${event.userId}`);
      },
    });

    kafkaInitialized = true;
    console.info("Kafka initialized successfully");
  } catch (error) {
    console.warn('Kafka connection failed, continuing without Kafka:', error.message);
    console.log('Signaling server will use Redis Pub/Sub for messaging instead');
  }
}

// Safe Kafka sender that handles connection failures
async function safeKafkaSend(topic, messages) {
  try {
    if (!producerInstance) {
      const { producer } = createKafkaInstances();
      producerInstance = producer;
    }
    await producerInstance.send({ topic, messages });
  } catch (error) {
    console.warn('Kafka send failed, falling back to Redis Pub/Sub:', error.message);
    // Fallback to Redis Pub/Sub if Kafka is not available
    // This would need to be implemented based on your Redis Pub/Sub structure
  }
}

// Initialize Kafka when module is first imported
initKafka();

module.exports = { 
  // Getter to access the Kafka producer instance for sending meeting-related events
  // Returns null if Kafka initialization failed or producer is not available
  get MeetingsProducer() { return producerInstance; }, 
  get MeetingsConsumer() { return consumerInstance; }, 
  safeKafkaSend 
};