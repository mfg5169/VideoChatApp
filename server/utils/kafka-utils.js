const { Kafka } = require('kafkajs');

// Kafka configuration
const KAFKA_CONFIG = {
    brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094'],
    clientId: 'meeting-endpoint-producer',
};

/**
 * Send a message to a Kafka topic with proper connection handling
 * @param {string} topic - The Kafka topic to send the message to
 * @param {Array} messages - Array of message objects with key and value
 * @param {number} timeoutMs - Timeout in milliseconds (default: 3000)
 * @returns {Promise<boolean>} - Returns true if successful, false if failed
 */
async function sendKafkaMessage(topic, messages, timeoutMs = 3000) {
    const kafka = new Kafka(KAFKA_CONFIG);
    const producer = kafka.producer();
    
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Kafka timeout')), timeoutMs)
    );
    
    try {
        await Promise.race([
            producer.connect().then(() => 
                producer.send({ topic, messages })
            ).finally(() => producer.disconnect()),
            timeoutPromise
        ]);
        
        console.info(`Successfully sent message to Kafka topic: ${topic}`);
        return true;
    } catch (error) {
        console.warn(`Failed to send Kafka message to topic ${topic}:`, error.message);
        console.log("Kafka Error: ", error);
        return false;
    }
}

/**
 * Send a meeting preparation command to the SFU
 * @param {string} sfuId - The SFU ID to send the command to
 * @param {string} meetingId - The meeting ID
 * @returns {Promise<boolean>} - Returns true if successful, false if failed
 */
async function sendMeetingPreparationCommand(sfuId, meetingId) {
    return await sendKafkaMessage('sfu_commands', [
        { 
            key: sfuId, 
            value: JSON.stringify({ 
                type: 'prepareMeeting', 
                payload: { meetingId: String(meetingId) } 
            }) 
        }
    ]);
}

module.exports = {
    sendKafkaMessage,
    sendMeetingPreparationCommand,
    KAFKA_CONFIG
};
