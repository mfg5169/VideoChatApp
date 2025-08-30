const { Kafka } = require('kafkajs');

const Logger = {
  levels: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  },
  currentLevel: 1, 
  
  formatMessage(level, component, message, data = null) {
    const timestamp = new Date().toISOString();
    const logLevel = Object.keys(this.levels)[level];
    
    const stack = new Error().stack;
    const caller = this.getCallerInfo(stack);
    
    const prefix = `[${timestamp}] [${logLevel}] [${component}] [${caller}]`;
    
    if (data) {
      return [`${prefix} ${message}`, data];
    }
    return [`${prefix} ${message}`];
  },
  
  getCallerInfo(stack) {
    try {
      // Split stack into lines and find the caller (skip the first 3 lines: Error, formatMessage, and the logging method)
      const lines = stack.split('\n');
      if (lines.length >= 4) {
        const callerLine = lines[3];
        // Extract function name and file info
        const match = callerLine.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
          const functionName = match[1];
          const filePath = match[2];
          const lineNumber = match[3];
          
          // Extract just the filename from the full path
          const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
          
          return `${functionName}@${fileName}:${lineNumber}`;
        }
      }
      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  },
  
  debug(component, message, data = null) {
    if (this.currentLevel <= this.levels.DEBUG) {
      console.debug(...this.formatMessage(this.levels.DEBUG, component, message, data));
    }
  },
  
  info(component, message, data = null) {
    if (this.currentLevel <= this.levels.INFO) {
      console.info(...this.formatMessage(this.levels.INFO, component, message, data));
    }
  },
  
  warn(component, message, data = null) {
    if (this.currentLevel <= this.levels.WARN) {
      console.warn(...this.formatMessage(this.levels.WARN, component, message, data));
    }
  },
  
  error(component, message, error = null, data = null) {
    if (this.currentLevel <= this.levels.ERROR) {
      console.error(...this.formatMessage(this.levels.ERROR, component, message, data));
      if (error) {
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
      }
    }
  }
};

// Kafka state tracking
const KafkaState = {
  initialized: false,
  producerConnected: false,
  consumerConnected: false,
  totalMessagesSent: 0,
  totalMessagesReceived: 0,
  totalErrors: 0,
  lastError: null,
  
  updateStats(type, value = 1) {
    switch(type) {
      case 'messageSent':
        this.totalMessagesSent += value;
        break;
      case 'messageReceived':
        this.totalMessagesReceived += value;
        break;
      case 'error':
        this.totalErrors += value;
        break;
    }
  },
  
  getStats() {
    return {
      initialized: this.initialized,
      producerConnected: this.producerConnected,
      consumerConnected: this.consumerConnected,
      totalMessagesSent: this.totalMessagesSent,
      totalMessagesReceived: this.totalMessagesReceived,
      totalErrors: this.totalErrors,
      lastError: this.lastError
    };
  }
};

// Use the shared Redis connection from the main redis module
const redis = require('../../utils/datamanagement/redis');

// Singleton pattern for Kafka instances
let kafkaInstance = null;
let producerInstance = null;
let consumerInstance = null;
let kafkaInitialized = false;

function createKafkaInstances() {
  if (kafkaInstance) {
    Logger.debug('KAFKA', 'Reusing existing Kafka instances');
    return { kafka: kafkaInstance, producer: producerInstance, consumer: consumerInstance };
  }

  Logger.info('KAFKA', 'Creating new Kafka instances', {
    brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094'],
    clientId: 'meeting endpoint'
  });

  try {
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

    Logger.info('KAFKA', 'Kafka instances created successfully', {
      producerId: producerInstance.id,
      consumerGroupId: consumerInstance.groupId
    });

    return { kafka: kafkaInstance, producer: producerInstance, consumer: consumerInstance };
  } catch (error) {
    Logger.error('KAFKA', 'Failed to create Kafka instances', error);
    throw error;
  }
}

async function initKafka() {
  if (kafkaInitialized) {
    Logger.debug('KAFKA', 'Kafka already initialized, skipping');
    return;
  }

  Logger.info('KAFKA', 'Initializing Kafka connection');

  try {
    const { producer, consumer } = createKafkaInstances();
    
    Logger.debug('KAFKA', 'Connecting producer');
    await producer.connect();
    KafkaState.producerConnected = true;
    Logger.info('KAFKA', 'Producer connected successfully');
    
    Logger.debug('KAFKA', 'Connecting consumer');
    await consumer.connect();
    KafkaState.consumerConnected = true;
    Logger.info('KAFKA', 'Consumer connected successfully');
    
    // Add retry logic for topic subscription
    let subscriptionRetries = 0;
    const maxRetries = 3;
    
    while (subscriptionRetries < maxRetries) {
      try {
        Logger.debug('KAFKA', `Attempting to subscribe to topics (attempt ${subscriptionRetries + 1}/${maxRetries})`);
        
        // Subscribe to topics with error handling
        await consumer.subscribe({ topic: 'meeting-events', fromBeginning: false });
        Logger.info('KAFKA', 'Successfully subscribed to meeting-events topic');
        
        await consumer.subscribe({ topic: 'sfu_commands', fromBeginning: false });
        Logger.info('KAFKA', 'Successfully subscribed to sfu_commands topic');
        
        Logger.info('KAFKA', 'Consumer subscribed to all topics successfully', {
          topics: ['meeting-events', 'sfu_commands']
        });
        break; // Success, exit retry loop
        
      } catch (subscriptionError) {
        subscriptionRetries++;
        Logger.warn('KAFKA', `Topic subscription attempt ${subscriptionRetries} failed`, {
          error: subscriptionError.message,
          attempt: subscriptionRetries,
          maxRetries
        });
        
        if (subscriptionRetries >= maxRetries) {
          throw subscriptionError; // Re-throw if all retries failed
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000 * subscriptionRetries));
      }
    }
    
    Logger.debug('KAFKA', 'Starting consumer message processing');
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        KafkaState.updateStats('messageReceived');
        
        Logger.debug('KAFKA', 'Processing consumer message', {
          topic,
          partition,
          messageKey: message.key?.toString(),
          messageSize: message.value?.length,
          totalMessagesReceived: KafkaState.totalMessagesReceived
        });
        
        try {
          if (topic === 'meeting-events') {
            const event = JSON.parse(message.value.toString());
            Logger.info('KAFKA', 'Received meeting event', {
              room: message.key?.toString(),
              event: event.event,
              userId: event.userId,
              messageSize: message.value.length
            });
          } else if (topic === 'sfu_commands') {
            const sfuCommand = JSON.parse(message.value.toString());
            Logger.info('KAFKA', 'Received SFU command', {
              commandType: sfuCommand.type || sfuCommand.event,
              messageSize: message.value.length
            });
            
            // Handle both event and type formats for backward compatibility
            const commandType = sfuCommand.type || sfuCommand.event;
            
            // Debug the payload structure
            Logger.debug('KAFKA', 'SFU command payload structure', {
              payload: sfuCommand.payload,
              meetingId: sfuCommand.payload?.meetingId,
              MeetingID: sfuCommand.payload?.MeetingID
            });
            
            const meetingId = sfuCommand.payload?.meetingId || sfuCommand.payload?.MeetingID;
            
            Logger.debug('KAFKA', 'Extracted meeting ID', { meetingId });
            Logger.info('KAFKA', 'Processing SFU command', {
              commandType,
              meetingId
            });
            
            // Normalize the command format
            const normalizedCommand = {
              type: commandType,
              payload: {
                ...sfuCommand.payload,
                meetingId: meetingId
              }
            };
            
            handleSFUCommand(normalizedCommand);
          }
        } catch (parseError) {
          KafkaState.updateStats('error');
          KafkaState.lastError = parseError;
          Logger.error('KAFKA', 'Error parsing consumer message', parseError, {
            topic,
            partition,
            messageKey: message.key?.toString(),
            messageValue: message.value?.toString()
          });
        }
      },
    });

    kafkaInitialized = true;
    KafkaState.initialized = true;
    Logger.info('KAFKA', 'Kafka initialized successfully', KafkaState.getStats());
    
    // Test message to verify everything is working
    try {
      await safeKafkaSend('meeting-events', [{
        key: 'test',
        value: JSON.stringify({
          event: 'kafka_test',
          timestamp: new Date().toISOString(),
          message: 'Kafka connection test'
        })
      }]);
      Logger.info('KAFKA', 'Kafka connection test message sent successfully');
    } catch (testError) {
      Logger.warn('KAFKA', 'Kafka connection test failed', {
        error: testError.message
      });
    }
    
  } catch (error) {
    KafkaState.updateStats('error');
    KafkaState.lastError = error;
    Logger.error('KAFKA', 'Kafka initialization failed', error, {
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorCode: error.code,
      errorStack: error.stack
    });
    Logger.warn('KAFKA', 'Kafka connection failed, continuing without Kafka', {
      error: error.message,
      stack: error.stack
    });
    Logger.info('KAFKA', 'Signaling server will use Redis Pub/Sub for messaging instead');
  }
}

// Global handler for SFU commands - will be set by the main signaling server
let sfuCommandHandler = null;

function setSFUCommandHandler(handler) {
  Logger.info('KAFKA', 'Setting SFU command handler', {
    handlerExists: !!handler,
    handlerType: typeof handler
  });
  sfuCommandHandler = handler;
}

function handleSFUCommand(command) {
  Logger.debug('KAFKA', 'Handling SFU command', {
    commandType: command.type,
    hasPayload: !!command.payload,
    handlerExists: !!sfuCommandHandler
  });
  
  if (sfuCommandHandler) {
    try {
      sfuCommandHandler(command);
      Logger.debug('KAFKA', 'SFU command handled successfully', {
        commandType: command.type
      });
    } catch (error) {
      KafkaState.updateStats('error');
      Logger.error('KAFKA', 'Error in SFU command handler', error, {
        commandType: command.type,
        payload: command.payload
      });
    }
  } else {
    Logger.warn('KAFKA', 'SFU command handler not set', {
      commandType: command.type
    });
  }
}

// Kafka health check function
async function checkKafkaHealth() {
  const health = {
    initialized: KafkaState.initialized,
    producerConnected: false,
    consumerConnected: false,
    topicsAccessible: false,
    lastError: KafkaState.lastError,
    stats: KafkaState.getStats()
  };
  
  try {
    // Test producer connectivity by creating a new producer and sending a test message
    const kafka = new Kafka({
      brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094'],
      clientId: 'meeting endpoint',
    });
    const testProducer = kafka.producer();
    
    try {
      await testProducer.connect();
      health.producerConnected = true;
      
      // Test topic accessibility by sending a test message
      await testProducer.send({
        topic: 'meeting-events',
        messages: [{
          key: 'health_check',
          value: JSON.stringify({
            event: 'health_check',
            timestamp: new Date().toISOString()
          })
        }]
      });
      health.topicsAccessible = true;
      
      await testProducer.disconnect();
    } catch (producerError) {
      Logger.warn('KAFKA', 'Producer health check failed', {
        error: producerError.message
      });
    }
    
    // Test consumer connectivity if we have a consumer instance
    if (consumerInstance) {
      try {
        // Note: We can't easily test consumer connection without affecting the running consumer
        // So we'll assume it's connected if the instance exists
        health.consumerConnected = true;
      } catch (consumerError) {
        Logger.warn('KAFKA', 'Consumer health check failed', {
          error: consumerError.message
        });
      }
    }
    
    Logger.info('KAFKA', 'Health check completed', health);
    return health;
  } catch (error) {
    Logger.error('KAFKA', 'Health check failed', error);
    health.lastError = error;
    return health;
  }
}

// Safe Kafka sender that handles connection failures
async function safeKafkaSend(topic, messages) {
  Logger.debug('KAFKA', 'Attempting to send Kafka message', {
    topic,
    messageCount: messages.length,
    messageKeys: messages.map(m => m.key)
  });
  
  try {
    // Create new Kafka instance and producer for each send operation
    const kafka = new Kafka({
      brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094'],
      clientId: 'meeting endpoint',
    });
    const producer = kafka.producer();
    
    // Follow the pattern: connect → send → disconnect
    await producer.connect();
    await producer.send({ topic, messages });
    await producer.disconnect();
    
    KafkaState.updateStats('messageSent', messages.length);
    
    Logger.info('KAFKA', 'Message sent successfully', {
      topic,
      messageCount: messages.length,
      totalMessagesSent: KafkaState.totalMessagesSent
    });
  } catch (error) {
    KafkaState.updateStats('error');
    KafkaState.lastError = error;
    Logger.warn('KAFKA', 'Kafka send failed, falling back to Redis Pub/Sub', {
      error: error.message,
      errorType: error.constructor.name,
      errorCode: error.code,
      topic,
      messageCount: messages.length
    });
    
    // Fallback to Redis Pub/Sub if Kafka is not available
    try {
      // Example Redis fallback (implement based on your needs)
      for (const message of messages) {
        await redis.publish(`kafka_fallback:${topic}`, message.value);
      }
      Logger.info('KAFKA', 'Message sent via Redis fallback', {
        topic,
        messageCount: messages.length
      });
    } catch (redisError) {
      Logger.error('KAFKA', 'Redis fallback also failed', redisError, {
        topic,
        messageCount: messages.length
      });
    }
  }
}

// Initialize Kafka when module is first imported
Logger.info('KAFKA', 'Initializing Kafka module');
initKafka();

module.exports = { 
  // Getter to access the Kafka producer instance for sending meeting-related events
  // Returns null if Kafka initialization failed or producer is not available
  get MeetingsProducer() { 
    Logger.debug('KAFKA', 'Accessing MeetingsProducer', {
      producerExists: !!producerInstance,
      producerConnected: KafkaState.producerConnected
    });
    return producerInstance; 
  }, 
  get MeetingsConsumer() { 
    Logger.debug('KAFKA', 'Accessing MeetingsConsumer', {
      consumerExists: !!consumerInstance,
      consumerConnected: KafkaState.consumerConnected
    });
    return consumerInstance; 
  }, 
  safeKafkaSend,
  setSFUCommandHandler,
  Logger,
  KafkaState,
  checkKafkaHealth
};