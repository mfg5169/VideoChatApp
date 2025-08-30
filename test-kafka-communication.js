const { Kafka } = require('kafkajs');

async function testKafkaCommunication() {
    console.log('Testing Kafka communication...');
    
    const kafka = new Kafka({
        brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094'],
        clientId: 'test-client',
    });
    
    const producer = kafka.producer();
    const consumer = kafka.consumer({ groupId: 'test-group' });
    
    try {
        // Connect
        await producer.connect();
        await consumer.connect();
        
        // Subscribe to sfu_commands topic
        await consumer.subscribe({ topic: 'sfu_commands', fromBeginning: true });
        
        console.log('Connected to Kafka and subscribed to sfu_commands topic');
        
        // Send a test message
        const testMessage = {
            key: 'test-sfu-id',
            value: JSON.stringify({
                type: 'webrtcSignal',
                payload: {
                    type: 'offer',
                    sdp: 'test-sdp',
                    senderId: 'test-client',
                    meetingId: 'test-meeting'
                }
            })
        };
        
        console.log('Sending test message:', testMessage);
        await producer.send({
            topic: 'sfu_commands',
            messages: [testMessage]
        });
        
        console.log('Test message sent successfully');
        
        // Listen for messages
        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                console.log('Received message:', {
                    topic,
                    partition,
                    key: message.key.toString(),
                    value: message.value.toString()
                });
            },
        });
        
        // Wait a bit to see if we receive the message
        setTimeout(async () => {
            await producer.disconnect();
            await consumer.disconnect();
            console.log('Test completed');
        }, 5000);
        
    } catch (error) {
        console.error('Error:', error);
        await producer.disconnect();
        await consumer.disconnect();
    }
}

testKafkaCommunication();
